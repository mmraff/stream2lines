// Built-ins
var crypto = require('crypto')
var fs = require('fs')
var path = require('path')
var stream = require('stream')
// 3rd party
var expect = require('chai').expect
var litGib = require('literal-gibberish')
var litGibXform = require('./litgib-unicode-xform.js')
// The test subject
var str2lns = require('../')

var typeCounts = {}

function newTestFileName(type) {
  if (!type) type = 'default'
  if (!(type in typeCounts)) typeCounts[type] = 0
  typeCounts[type]++

  return type + '-' + typeCounts[type] + '.txt'
}

function getFilepath(fname) {
  return path.join('test', 'assets', fname)
}


describe('stream2lines module tests', function() {

  var fpathname, fileExists

  afterEach('cleanup', function() {
    if (fileExists) {
      fs.unlink(fpathname, function(fsErr) {
        if (fsErr) console.warn("WARNING: failed to delete", fpathname)
      })
      fileExists = false
      fpathname = null
    }
  })

  function runCoreReaderTest(rst, options, data, flags, next) {
    var lnCount = 0
    var endReached = false
    var destroySrc = (options && 'autoDestroySource' in options) ?
      options.autoDestroySource : false
    var encoding = (options && 'encoding' in options) ?
      options.encoding : null

    // Workaround for encoding 'latin1' that doesn't exist in node < v6
    // (Note that stream2lines handles this internally; but here we'll be
    // comparing to a buffer that's external to the reader)
    if (encoding === 'latin1' && !Buffer.isEncoding('latin1'))
      encoding = 'binary'

    str2lns(rst, options)
      .once('end', function() {
        // This shall emit 'end' only if the source stream did so; evidence
        // will be completely consumed buffer in source stream
        expect(rst._readableState.length).to.eql(0)
        expect(rst._readableState.buffer.length).to.eql(0)
        // and this line count will be same as what was written to source file
        expect(this.lineCount()).to.eql(data.lines.length)
        endReached = true
      })
      .once('close', function() {
        // Here we know: if there was an error, there's no handler,
        // so it was thrown, and we didn't get here.
        if (!endReached) {
          expect(this.lineCount()).to.be.below(data.lines.length)
        }
        if ((endReached && rst.autoClose) || destroySrc) {
          expect(rst._readableState.length).to.eql(0)
          expect(rst._readableState.buffer.length).to.eql(0)
          if ('fd' in rst) // it's not there in a http.IncomingMessage
            process.nextTick(function() {
              expect(rst.fd).to.be.null
              next()
            })
        }
        else next()
      })
      .on('readable', function() {
        var text, ln
        while ((text = this.read()) != null) {
          ln = data.lines[lnCount++]
          expect(text).to.eql(data.buffer.toString(encoding, ln.start, ln.end))
          expect(this.lineCount()).to.eql(lnCount)

          if (flags.testClose) {
            this.close()
            break
          }
        }
      })
  }

  it('should export a function', function() {
    expect(str2lns).to.be.a('function')
  })

  it('should throw Assertions for bad stream.Readable argument cases', function() {

    expect(function(){ return str2lns() })
      .to.throw(Error, "Must give a Readable Stream")

    var src = new stream.Readable({ highWaterMark: 65 * 1024 })
    expect(function(){ return str2lns(src) })
      .to.throw(Error, /Stream has inappropriate highWaterMark: /)
  })

  it('should throw Assertions for invalid values for valid options', function() {
    var src = new stream.Readable()
    var testOptions = {}
    function runOptionsTest() { return str2lns(src, testOptions) }

    testOptions.encoding = 'smurf'
    expect(runOptionsTest).to.throw(Error, /Encoding not valid here: /)

    testOptions.encoding = 'hex' // A valid encoding for node buffers
    expect(runOptionsTest).to.throw(Error, /Encoding not valid here: /)

    testOptions = { eolMatch: 666 }
    expect(runOptionsTest).to.throw(Error, "eolMatch option must be a string")

    testOptions.eolMatch = 'WHATEVER'
    expect(runOptionsTest).to.throw(Error, /Invalid EOL match type for utf8 encoding: /)

    testOptions.encoding = 'ascii'
    testOptions.eolMatch = 'all'
    expect(runOptionsTest).to.throw(Error, /Invalid EOL match type for ascii encoding: /)

    testOptions = { maxLineLength: 'infinity' }
    expect(runOptionsTest).to.throw(Error, /Invalid maxLineLength: /)

    testOptions.maxLineLength = 102.3
    expect(runOptionsTest).to.throw(Error, /Invalid maxLineLength: /)

    testOptions.maxLineLength = -999
    expect(runOptionsTest).to.throw(Error, /Invalid maxLineLength: /)

    testOptions = { autoDestroySource: null }
    expect(runOptionsTest).to.throw(Error, /Invalid autoDestroySource option value: /)

    testOptions.autoDestroySource = 'yeah'
    expect(runOptionsTest).to.throw(Error, /Invalid autoDestroySource option value: /)
  })

  it('should use defaults when no options, and behave according to input', function(done) {
    // Default max line length is 4096. Base64 conversion will bloat the length,
    // but we want to be reasonably sure of excess for all but the 1st test here:
    var testInSize = 5000
      , qtrSize  = testInSize/4
      , halfSize = testInSize/2

    crypto.randomBytes(testInSize, function(err, buf) {
      if (err) throw err;

      // 1. Feed the reader text where the lines are guaranteed less than the
      //    default maxLineLength; expect it not to throw
      var s = [
        buf.toString('base64', 0, qtrSize),
        buf.toString('base64', qtrSize, halfSize),
        buf.toString('base64', halfSize, halfSize + qtrSize),
        buf.toString('base64', halfSize + qtrSize)
      ].join('\n')
 
      var thru = new stream.PassThrough()
      var rdr = str2lns(thru)
        .on('readable', function() {
          var sOut

          function readWrapper() {
            sOut = rdr.read()
          }

          while (true) {
            expect(readWrapper).to.not.throw(Error)
            if (sOut === null) break
            expect(sOut).to.be.a('string')
            expect(sOut).to.have.length.within(1, 4096)
          }
        })
        .once('end', function() {
          rdr.close() // Just to be clean
          proceedToTest2NoOpts()
        })

      thru.write(s)
      thru.end()

      // 2. Do not subscribe to the 'error' event, but feed the reader text
      //   that is guaranteed to contain a line that exceeds the default max;
      //   expect it to throw.
      function proceedToTest2NoOpts() {
        function readWrap() { rdr.read() }
        thru = new stream.PassThrough()
        rdr = str2lns(thru)
          .once('readable', function() {
            expect(readWrap).to.throw(Error, "Maximum line length exceeded")

            proceedToTest3NoOpts()
          })
        thru.write(buf.toString('base64'))
      }

      // 3. Subscribe to the 'error' event, then feed the reader text that is
      //   guaranteed to contain a line that exceeds the default max;
      //   expect it to emit an error.
      function proceedToTest3NoOpts() {
        rdr = str2lns(thru)
          .on('error', function(rdrErr) {
            expect(rdrErr.message).to.equal("Maximum line length exceeded")
          })
          .once('readable', function() {
            expect(rdr.read()).to.be.null
            done()
          })
        thru.write(buf.toString('base64'))
      }
    })
  })

  it('should allow lines of any length with option maxLineLength = 0', function(done) {

    crypto.randomBytes(10000, function(err, buf) {
      if (err) throw err

      var s = buf.toString('hex') // 20000 chars without EOL - that's a long line
      var thru = new stream.PassThrough()
      function testFunc() {
        str2lns(thru, { maxLineLength: 0 })
          .on('readable', function() {
            var ln
            while ((ln = this.read()) != null) {}
          })
        thru.write(s)
        thru.end()
      }

      expect(testFunc).to.not.throw(Error)
      done()
    })
  })

  it('should behave according to non-zero setting of option maxLineLength', function(done) {
    var testInSize = 5000 // greater than default maxLineLength

    crypto.randomBytes(testInSize, function(err, buf) {
      if (err) throw err;

      var s = buf.toString('base64')
        , thru = new stream.PassThrough()
        , sOut
        , rdr

      function readWrapper() {
        sOut = rdr.read()
      }

      rdr = str2lns(thru, { maxLineLength: s.length })
        .on('readable', function() {
          while (true) {
            expect(readWrapper).to.not.throw(Error)
            if (sOut === null) break
            expect(sOut).to.be.a('string')
            expect(sOut).to.have.length.of.at.most(s.length)
          }
        })
        .once('end', function() {
          rdr.close() // Just to be clean
          proceedToThrowTest()
        })

      thru.write(s)
      thru.write('\n' + s)
      thru.end()

      function proceedToThrowTest() {
        thru = new stream.PassThrough()
        rdr = str2lns(thru, { maxLineLength: s.length - 1 })
          .once('readable', function() {
            expect(readWrapper).to.throw(Error, "Maximum line length exceeded")
            done()
          })

        thru.write(s)
      }
    })
  })

  it('should allow user to stop the flow and disengage ' +
     'before the source is exhausted', function(done) { // Give close() a workout

    fpathname = getFilepath(newTestFileName())

    litGib(function(lgErr, data) { // default 'ascii' with 'lf'
      if (lgErr) throw lgErr

      var options = { encoding: 'ascii', eolMatch: 'lf' }

      fs.writeFile(fpathname, data.buffer, function(fsErr) {
        if (fsErr) throw fsErr

        fileExists = true

        var rst = fs.createReadStream(fpathname)
        runCoreReaderTest(rst, options, data, { testClose: true }, done)
      })
    })
  })

  var allEolMatches = str2lns.eolMatches('utf8')
  var validEncodings = str2lns.encodings()
  validEncodings.forEach(function(enc) {
    it("should work correctly with explicit encoding '" + enc
       + "' according to each EOL match option", function(done) {

      var myEolMatches = str2lns.eolMatches(enc)
      var eolIdx = 0
      nextTest()

      function nextTest() {
        if (eolIdx === allEolMatches.length) return done()

        var lgEnc, eol, eolMatch = allEolMatches[eolIdx++]
        // To determine the encoding of the test buffer of gibberish (lgEnc):
        switch (enc) {
          case 'ascii':
          case 'latin1': lgEnc = enc; break
          case 'binary': lgEnc = 'win1252'; break
          default:       lgEnc = 'latin1'
        }
        // To determine the (initial) EOL marker to separate lines in the buffer
        switch (eolMatch) {
          case 'crlf':
          case 'lf':      eol = eolMatch; break
          case 'basic':
          case '7bit':    eol = 'crlf'; break
          case 'iso8859':
          case 'all':
            eol = (enc != 'ascii' && enc != 'binary') ? 'nel' : 'lf'; break
          default:
            // Of course, this should never happen
            console.log("eolMatch default case on", JSON.stringify(eolMatch))
            return nextTest()
        }

        litGib({ encoding: lgEnc, eol: eol, size: 2048 }, function(lgErr, data) {
          if (lgErr) throw lgErr

          var thru = new stream.PassThrough()
          var opts = { encoding: enc, eolMatch: eolMatch }

          // This block works as an adapter for the multibyte encodings.
          // It adjusts data.buffer and data.lines.
          if (enc.charAt(0) === 'u') { // 'utf8', 'utf16le', 'ucs2'
            litGibXform(data, enc, eol, eolMatch === 'all')
          }

          // This function is meant to throw an AssertionError.
          // If it doesn't, then the expect() that contains it will throw,
          // so nextTest() will never be called either way.
          function throwerFunc() {
            runCoreReaderTest(thru, opts, data, {}, nextTest)
          }

          if (myEolMatches.indexOf(eolMatch) == -1 ) {
            expect(throwerFunc).to.throw(Error, /Invalid EOL match type for /)
            nextTest()
          }
          else {
            runCoreReaderTest(thru, opts, data, {}, nextTest)
            thru.write(data.buffer)
            thru.end()
          }
        })
      }
    })
  })

  it("should destroy non-autoClose source stream when "
     + "option 'autoDestroySource' is set", function(done) {

    fpathname = getFilepath(newTestFileName())

    litGib({ size: 4096 }, function(lgErr, data) {
      if (lgErr) throw lgErr

      fs.writeFile(fpathname, data.buffer, function(fsErr) {
        if (fsErr) throw fsErr
        fileExists = true

        var rst = fs.createReadStream(fpathname, { autoClose: false })
        str2lns(rst, { autoDestroySource: true })
          .on('readable', function() {
            var ln
            while((ln = this.read()) != null) {}
          })
          .on('close', function() {
            process.nextTick(function() {
              expect(rst.fd).to.be.null
              done()
            })
          })
      })
    })
  })

  it("should NOT destroy non-autoClose source stream when "
     + "option 'autoDestroySource' is NOT set", function(done) {

    fpathname = getFilepath(newTestFileName())

    litGib({ size: 4096 }, function(lgErr, data) {
      if (lgErr) throw lgErr

      fs.writeFile(fpathname, data.buffer, function(fsErr) {
        if (fsErr) throw fsErr
        fileExists = true

        var rst = fs.createReadStream(fpathname, { autoClose: false })
        str2lns(rst, { autoDestroySource: false })
          .on('readable', function() {
            var ln
            while((ln = this.read()) != null) {}
          })
          .on('close', function() {
            process.nextTick(function() {
              expect(rst.fd).to.not.be.null
              rst.once('close', function() { done() })
              rst.destroy()
            })
          })
      })
    })
  })

})


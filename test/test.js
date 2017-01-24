// Built-ins
var crypto = require('crypto')
  , fs = require('fs')
  , http = require('http')
  , net = require('net')
  , path = require('path')
  , spawn = require('child_process').spawn
  , stream = require('stream')
// 3rd party
  , expect = require('chai').expect
  , litGib = require('literal-gibberish')
  , litGibXform = require('./lib/litgib-unicode-xform.js')
  , rimraf = require('rimraf')
// The test subject
  , str2lns = require('../')

var typeCounts = {}
  , tempDir = 'temp'
  , killCmd = 'halt'

function newTestFileName(type) {
  if (!type) type = 'default'
  if (!(type in typeCounts)) typeCounts[type] = 0
  typeCounts[type]++

  return type + '-' + typeCounts[type] + '.txt'
}

function getFilepath(fname) {
  return path.join('test', tempDir, fname)
}

before(function() {
  try { fs.mkdirSync(path.join('test', tempDir)) }
  catch (mkdErr) {
    if (mkdErr.code !== 'EEXIST') throw mkdErr
  }
})

after(function(done) {
  rimraf(path.join('test', tempDir), function(rmErr) {
    if (rmErr) {
      console.warn("Failed to remove the test temporary directory...")
      console.warn(rmErr)
      // Oh well, not so important, considering it's after the tests
    }
    done(rmErr)
  })
})

describe('stream2lines module basic tests', function() {

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
}) // End of basic tests

// This is used by tests using fs.ReadStream, http.IncomingMessage, and net.Socket
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
        // Maybe this is questionable - was close() called on the last line,
        // before read() returned null that triggers 'end' event?
        // Answer: just don't set up a test to produce that condition!
        expect(this.lineCount()).to.be.below(data.lines.length)
      }
      if ((endReached && rst.autoClose) || destroySrc) {
        // Yes, it's bad form to refer to 3rd-party object properties that have
        // underscored names, because that's a legacy convention that means 'private',
        // or at least undocumented, and such properties can't be relied on to
        // be in future versions of the 3rd-party module...
        // but for that matter, 'autoClose' is not documented as a property of a
        // ReadStream.
        // However, we need *something* to help us doublecheck the state here.
        if (rst._readableState) {
          expect(rst._readableState.length).to.eql(0)
          expect(rst._readableState.buffer.length).to.eql(0)
        }
        // Disposal of fd has been seen to take some time...
        process.nextTick(function() {
          // DANGER here: if the http.IncomingMessage is the response to a request
          // that included an explicit http.Agent, rst.socket._handle will still
          // be non-null, and it will have fd with a live file descriptor.
          var src = (rst instanceof http.IncomingMessage) ? rst.socket._handle : rst
          if (src && 'fd' in src) expect(src.fd).to.be.null
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

describe('stream2lines module with fs.ReadStream', function() {

  it('should allow user to stop the flow and disengage ' +
     'before the source is exhausted', function(done) { // Exercise close()

    litGib(function(lgErr, data) { // default 'ascii' with 'lf'
      if (lgErr) throw lgErr

      var fpathname = getFilepath(newTestFileName())
      var options = { encoding: 'ascii', eolMatch: 'lf' }

      fs.writeFile(fpathname, data.buffer, function(fsErr) {
        if (fsErr) throw fsErr

        var rst = fs.createReadStream(fpathname)
        runCoreReaderTest(rst, options, data, { testClose: true }, done)
      })
    })
  })

  // The following represents a matrix of tests, encoding vs. eolMatch
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

    litGib({ size: 4096 }, function(lgErr, data) {
      if (lgErr) throw lgErr

      var fpathname = getFilepath(newTestFileName())

      fs.writeFile(fpathname, data.buffer, function(fsErr) {
        if (fsErr) throw fsErr

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

    litGib({ size: 4096 }, function(lgErr, data) {
      if (lgErr) throw lgErr

      var fpathname = getFilepath(newTestFileName())

      fs.writeFile(fpathname, data.buffer, function(fsErr) {
        if (fsErr) throw fsErr

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

describe('stream2lines module with http.IncomingMessage', function() {

  var serverPort
    , serverProc
    , litGibData
    , fname = newTestFileName()
    , endFunc = function() { throw new Error("Server aborted!") }

  function closeServer() {
    http.get({
      port: serverPort,
      path: '/?' + killCmd
    })
  }

  before(function(done) {
    var spawnOpts = { detached: true }
    serverProc = spawn('node', ['test/lib/test-http-server.js'], spawnOpts)
      .on('close', function(code) {
        if (code) console.log('test-http-server exited with error', code)
        endFunc()
      })
    serverProc.stderr.on('data', function(data) {
      console.log('test-http-server stderr output:', data.toString())
    })
    serverProc.stdout.on('data', function(data) {
      var matches = data.toString().match(/^LISTENING ON (.+)/)
      if (!matches) return

      serverPort = matches[1]

      // Get some gibberish and write a corresponding file to use for all tests
      // in this group
      litGib({ size: 65 * 1024 }, function(lgErr, data) { // default 'ascii' with 'lf'
        if (lgErr) throw lgErr

        litGibData = data

        var fpathname = getFilepath(fname)

        fs.writeFile(fpathname, data.buffer, function(fsErr) {
          if (fsErr) throw fsErr
          done()
        })
      })
    })
  })

  after(function(done) {
    if (serverPort) endFunc = done
    closeServer()
  })

  it('should work correctly with defaults', function(done) {

    var httpOptions = {
      port: serverPort,
      path: '/?asset=' + fname
    }
    var readerOptions = { encoding: 'ascii' }

    http.get(httpOptions, function(res) {
      //res.once('close', function() { console.log('http response 1 close event') })
      //  .once('end', function() { console.log('http response 1 end event') })
      runCoreReaderTest(res, readerOptions, litGibData, {}, done) // function(err) {
      //  console.log("Reader test 1 callback follow-up")
      //  done(err)
      //})
    })
  })

  it('should close source stream when given option autoDestroySource', function(done) {

    var httpOptions = {
      port: serverPort,
      headers: { 'Connection': 'keep-alive' },
      path: '/?asset=' + fname
    }
    var readerOptions = { encoding: 'ascii', autoDestroySource: true }

    http.get(httpOptions, function(res) {
      //res.once('close', function() { console.log('http response 2 close event') })
      //  .once('end', function() { console.log('http response 2 end event') })
      runCoreReaderTest(res, readerOptions, litGibData, {}, done) // function(err) {
      //  console.log("Reader test 2 callback follow-up")
      //  done(err)
      //})
    })
  })

  it('should allow user to stop the flow and disengage ' +
     'before the source is exhausted', function(done) { // Exercise close()

    var httpOptions = {
      port: serverPort,
      path: '/?asset=' + fname
    }
    var readerOptions = { encoding: 'ascii' }

    http.get(httpOptions, function(res) {
      //res.once('close', function() { console.log('http response 3 close event') })
      //  .once('end', function() { console.log('http response 3 end event') })
      runCoreReaderTest(res, readerOptions, litGibData, { testClose: true }, done)
    })
  })

  it('should allow user to close early and autoDestroySource', function(done) {

    var httpOptions = {
      port: serverPort,
      path: '/?asset=' + fname
    }
    var readerOptions = { encoding: 'ascii', autoDestroySource: true }

    http.get(httpOptions, function(res) {
      // NOTE: this is *the*only*test from which I've seen the 'close' event from http.IncomingMessage
      //res.once('close', function() { console.log('http response 4 close event') })
      //  .once('end', function() { console.log('http response 4 end event') })
      runCoreReaderTest(res, readerOptions, litGibData, { testClose: true }, done)
    })
  })
})

describe('stream2lines module with net.Socket', function() {

  var serverPort
    , serverProc
    , litGibData
    , fname = newTestFileName()
    , endFunc = function() { throw new Error("Server aborted!") }

  function closeServer() {
    net.connect(serverPort, function() {
      this.end(killCmd)
    })
    // DEBUG ONLY:
/*    .on('data', function(data) {
        var res = data.toString()
        console.log("On client.write('"+killCmd+"'), server says", res)
      })
*/
  }

  before(function(done) {
    var spawnOpts = { detached: true }
    serverProc = spawn('node', ['test/lib/test-tcp-server.js'], spawnOpts)
      .on('close', function(code) {
        if (code) console.error('test-tcp-server exited with error', code)
        endFunc()
      })
      .on('error', function(err) {
        console.error('Spawned tcp server process emitted error')
        throw err
      })
    serverProc.stderr.on('data', function(data) {
      console.error('test-tcp-server stderr output:\n', data.toString())
    })
    serverProc.stdout.on('data', function(data) {
      var matches = data.toString().match(/^LISTENING ON (.+)/)
      if (!matches) return

      serverPort = matches[1]

      // Get some gibberish and write a corresponding file to use for all tests
      // in this group
      litGib({ size: 65 * 1024 }, function(lgErr, data) { // default 'ascii' with 'lf'
        if (lgErr) throw lgErr

        litGibData = data

        var fpathname = getFilepath(fname)

        fs.writeFile(fpathname, data.buffer, function(fsErr) {
          if (fsErr) throw fsErr
          done()
        })
      })
    })
  })

  after(function(done) {
    if (serverPort) endFunc = done
    closeServer()
  })

  it('should work correctly with defaults', function(done) {

    net.connect(serverPort, function() {
      var readerOpts = { encoding: 'ascii' }
      this.write('asset='+fname+'\n')
      runCoreReaderTest(this, readerOpts, litGibData, {}, done) //function(err) {
      //  console.log("Reader test 1 callback follow-up")
      //  done(err)
      //})
    })//.once('close', function() { console.log('tcp response 1 close event') })
      //.once('end', function() { console.log('tcp response 1 end event') })
  })

  it('should close source stream when given option autoDestroySource', function(done) {

    net.connect(serverPort, function() {
      var readerOpts = { encoding: 'ascii', autoDestroySource: true }
      this.write('asset='+fname+'\n')
      runCoreReaderTest(this, readerOpts, litGibData, {}, done) //function(err) {
      //  console.log("Reader test 2 callback follow-up")
      //  done(err)
      //})
    })//.once('close', function() { console.log('tcp response 2 close event') })
      //.once('end', function() { console.log('tcp response 2 end event') })
      .setKeepAlive(true, 1000) // for behavior like autoClose:false
  })

  it('should allow user to stop the flow and disengage ' +
     'before the source is exhausted', function(done) { // Exercise close()

    net.connect(serverPort, function() {
      var sock = this
        , readerOpts = { encoding: 'ascii' }
      sock.write('asset='+fname+'\n')
      runCoreReaderTest(sock, readerOpts, litGibData, { testClose: true }, function(err) {
        //console.log("Reader test 3 callback follow-up")
        sock.end()
        done(err)
      })
    })//.once('close', function() { console.log('tcp response 3 close event') })
      //.once('end', function() { console.log('tcp response 3 end event') })
      .setKeepAlive(true, 1000) // for behavior like autoClose:false
  })

  it('should allow user to close early and autoDestroySource', function(done) {

    net.connect(serverPort, function() {
      var sock = this
        , readerOpts = { encoding: 'ascii', autoDestroySource: true }
      sock.write('asset='+fname+'\n')
      runCoreReaderTest(sock, readerOpts, litGibData, { testClose: true }, done) //function(err) {
      //  console.log("Reader test 4 callback follow-up")
        // Tests showed that there was no error here, and sock object in good
        // condition (destroyed, of course), even with later ECONNREFUSED error.
      //  done(err)
      //})
    })//.once('close', function() { console.log('tcp response 4 close event') })
      //.once('end', function() { console.log('tcp response 4 end event') })
      .setKeepAlive(true, 1000) // for behavior like autoClose:false
  })
})


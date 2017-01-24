var assert = require('assert')
  , events = require('events')
  , fs = require('fs')
  , http = require('http')
  , net = require('net')
  , stream = require('stream')
  , util = require('util')

var RE_DOS = /([\w\W]*?)((?:\r\n)|$)/
  , RE_UNIX = /([^\n]*)(\n|$)/
  , RE_BASIC =  /([^\n\r]*)((?:\r\n)|[\n\r]|$)/
  , RE_7BIT = /([^\f\n\r\v]*)((?:\r\n)|[\f\n\r\v]|$)/
  , RE_ISO_8859 = /([^\f\n\r\v\u0085]*)((?:\r\n)|[\f\n\r\v\u0085]|$)/
  , RE_ALL =  /([^\f\n\r\v\u0085\u2028\u2029]*)((?:\r\n)|[\f\n\r\v\u0085\u2028\u2029]|$)/
/*
 * RE_BASIC covers only Unix/Linux, Windows/DOS, and Mac OS Classic EOL markers
    (\n, \r\n, and \r, respectively)
 * RE_7BIT covers everything that is safe to count as a line ending in strictly
    single-byte encodings
 * RE_ISO_8859 adds the 8-bit NEXT LINE (NEL) marker to the RE_7BIT coverage
 * RE_ALL covers all end-of-line markers specified in this ref:
    http://www.unicode.org/reports/tr18/#Line_Boundaries

 * String.match(re) returns an array-like list with these elements:
   [0]: the prefix of the string up to and including the first EOL marker,
     or the entire string if no EOL marker
   [1]: the prefix without the EOL marker
   [2]: the EOL marker, if any
*/

function LineReader(rs, options) {
  var self = this
    , maxLen = options.maxLineLength
    , destroySrc = options.autoDestroySource
    , enc = options.encoding
    , backlog = null
    , lnCount = 0
    , re = null
    , srcEnded = false
    , srcError = false
    , closing = false // TODO: may be able to get rid of this

  function notifyEnd() {
    self.emit('end')
    self.close()
  }

  function onStreamReadable() {
    if (closing) {
      // Apparently this block is never visited! But keep this output, and watch for it
      console.log("onStreamReadable: closing, but we're still subscribed")
      return
    }
    if (srcEnded) {
      //console.log("'readable' event, but the stream already emitted 'end'") // DEBUG
      return
    }
    var readResult = rs.read()
    if (readResult !== null)
      backlog = backlog ? backlog + readResult : readResult
    else {
      // If there is a 'readable' event, but read() gives null, => End Of Stream
      srcEnded = true
      if (backlog === null) return notifyEnd()
    }
    self.emit('readable')
  }

  function onStreamError(err) {
    self.emit('error', err)
    srcError = true
    self.close()
  }

  // This is only applicable when rs is/has instance of fs.ReadStream or net.Socket
  function onStreamClose() {
    if (!srcEnded) {
      if (destroySrc) rs.read() // drain anything left in the internal buffer of rs
      rs = null
    }
    self.emit('close')
  }

  // API ---------------------------------------------

  this.lineCount = function() { return lnCount }

  this.close = function() {
    rs.removeListener('readable', onStreamReadable)
    if (!srcError) rs.removeListener('error', onStreamError)
    if (destroySrc) {
      //var src = (rs instanceof http.IncomingMessage) ? rs.socket : rs
      //if (typeof src.destroy == 'function') src.destroy()
      if (typeof rs.destroy == 'function') rs.destroy()
      //else console.log("line-reader.close: this stream doesn't have destroy()") // DEBUG ONLY
    }
    else {
      if (backlog !== null) rs.unshift(backlog)
      rs.removeListener('close', onStreamClose)
      rs = null
      this.emit('close')
    }
    backlog = null
    closing = true // TODO: may be able to get rid of this
  }

  this.read = function() {
    var matches, chunk

    if (closing) {
      //console.log("line-reader.read: state is closing") // DEBUG
      if (backlog !== null)
        //console.log("line-reader.read: Non-empty backlog!") // DEBUG
      return null
    }

    if (backlog === null) {
      if (!srcEnded) rs.once('readable', onStreamReadable)
      return null
    }

    lnCount++
    matches = backlog.match(re)
    if (maxLen && maxLen < matches[1].length) {
      this.emit('error', new Error("Maximum line length exceeded"))
      //console.log("maxLen:", maxLen, "; line length:", matches[1].length) // DEBUG ONLY
      //console.log("Error line:", matches[1].slice(0, 40), "...") // DEBUG ONLY
      this.close()
      return null
    }
    if (matches[0] === backlog) {
      if (srcEnded) {
        backlog = null
        process.nextTick(notifyEnd)
        return matches[1]
      }
      if (!matches[2] || matches[2] === '\r') {
        // No EOL found, or we matched the entire backlog with a '\r' on the end
        // and the next character might be '\n' waiting on the next rs.read()...
        lnCount--
        rs.once('readable', onStreamReadable)
        return null
      }
      backlog = null
    }
    else backlog = backlog.slice(matches[0].length)

    return matches[1]
  }

  // Workaround for encoding 'latin1' that doesn't exist in node < v6
  if (enc === 'latin1' && !Buffer.isEncoding('latin1')) enc = 'binary'

  switch (options.eolMatch) {
    case 'crlf':    re = RE_DOS; break
    case 'lf':      re = RE_UNIX; break
    case 'basic':   re = RE_BASIC; break
    case '7bit':    re = RE_7BIT; break
    case 'iso8859': re = RE_ISO_8859; break
    case 'all':     re = RE_ALL
  }
  rs.pause()
    .setEncoding(enc)
    .once('error', onStreamError)
    .once('readable', onStreamReadable)

  if (destroySrc || rs.autoClose) {
    // http.IncomingMessage 'close' event found to be completely unreliable (in v.0.12)!
    if (rs instanceof http.IncomingMessage)
      rs.socket.once('close', onStreamClose)
    else rs.once('close', onStreamClose)
  }
}

util.inherits(LineReader, events.EventEmitter)

var EOL_EQUIV = {
  dos: 'crlf',
  rfc2046: 'crlf',
  linux: 'lf',
  unix: 'lf'
}
var MATCHLEVELS = [
  { 'crlf': true, 'lf': true, 'basic': true, '7bit': true },
  { 'iso8859': true },
  { 'all': true }
]
var ENCMAP = {
  'ascii': {
    matchLevel: 0,
    defaultMatch: '7bit'
  },
  'binary': {
    matchLevel: 0,
    defaultMatch: '7bit'
  },
  'latin1': {
    matchLevel: 1,
    defaultMatch: 'iso8859'
  },
  'utf8': {
    matchLevel: 2,
    defaultMatch: 'all'
  },
  'utf16le': {
    matchLevel: 2,
    defaultMatch: 'all'
  },
  'ucs2': {
    matchLevel: 2,
    defaultMatch: 'all'
  }
}

// The bigger than buffer, the less read ops on the underlying source, so the
// more efficient... *but* also the more bloated in memory use.
var maxBufSize = 64 * 1024 // default for a fs.ReadStream

module.exports = function(rs, options) {
  assert(rs && rs instanceof stream.Readable, "Must give a Readable Stream")
  assert(rs._readableState.highWaterMark <= maxBufSize ||
         (rs._readableState.length < maxBufSize && rs._readableState.ended),
    "Stream has inappropriate highWaterMark: " + rs._readableState.highWaterMark)

  options = options || {}

  var enc = options.encoding || 'utf8'
  assert(ENCMAP[enc], "Encoding not valid here: " + enc)

  var eolMatch = options.eolMatch
  var validEolMatch = false
  if (eolMatch) {
    assert(typeof eolMatch === 'string', "eolMatch option must be a string")
    eolMatch = eolMatch.toLowerCase()
    if (eolMatch in EOL_EQUIV) eolMatch = EOL_EQUIV[eolMatch]
    for (var i = 0; i <= ENCMAP[enc].matchLevel; i++)
      if (eolMatch in MATCHLEVELS[i]) {
        validEolMatch = true;
        break;
      }
  }

  // Rude rejection option
  assert(!eolMatch || validEolMatch,
    'Invalid EOL match type for '+enc+' encoding: ' + options.eolMatch)

  // Quiet accommodation option; if we go with the Rude way, keep this, but we
  // can remove the check of validEolMatch, because false won't pass the assertion.
  if (!eolMatch || !validEolMatch)
    eolMatch = ENCMAP[enc].defaultMatch

  var maxLen = 'maxLineLength' in options ? options.maxLineLength : 4096
  assert(!isNaN(parseInt(maxLen)) &&
         maxLen.toString() === parseInt(maxLen).toString() && maxLen > -1,
    "Invalid maxLineLength: " + maxLen)

  // Leave it up to the user to say whether rs gets destroyed in case of
  // * maxLineLength exceeded
  // * close() called before EOF (because no more lines are needed)
  var destroySrc = false
  if ('autoDestroySource' in options) {
    assert(typeof options.autoDestroySource === 'boolean',
      "Invalid autoDestroySource option value: " + options.autoDestroySource)
    destroySrc = options.autoDestroySource
    // But we won't be fooled into recklessness
    if (destroySrc &&
        !(rs instanceof fs.ReadStream ||
          rs instanceof net.Socket ||
          rs instanceof http.IncomingMessage))
      // This covers process.stdin, which is a tty.ReadStream
      destroySrc = false
  }

  return new LineReader(rs, {
    encoding: enc,
    eolMatch: eolMatch,
    maxLineLength: +maxLen,
    autoDestroySource: destroySrc
  })
}

// These are provided for module testing
module.exports.encodings = function() { return Object.keys(ENCMAP) }

module.exports.eolMatches = function(enc) {
  assert(typeof enc === 'string' && enc in ENCMAP, 'Must give an encoding')
  var keys = [];
  for (var i = 0; i <= ENCMAP[enc].matchLevel; i++)
    keys = keys.concat(Object.keys(MATCHLEVELS[i]))
  return keys
}


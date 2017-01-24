
// eol is the end-of-line marker to expect;
// varyEOLs says whether it's OK to overwrite found EOLs with alternates
// *** when eol=='nel' *** --- which will be valuable for test coverage.
module.exports = function(data, encoding, eol, varyEOLs) {

  var eolBytes, altBytes
  if (encoding === 'utf8') {
    switch (eol) {
      case 'lf': eolBytes= [10]; break
      case 'cr': eolBytes = [13]; break
      case 'crlf': eolBytes = [13, 10]; break
      case undefined:
      case 'nel': eolBytes = [194, 133]; break
      default: throw new Error('Unrecognized EOL value ' + JSON.stringify(eol))
    }
    // The utf-8 encoding of '\u2028' takes 3 bytes, which would require
    // rewriting the entire buffer, so we won't do that. Instead, we'll
    // alternate with CRLF when varyEOLs==true and eol==NEL
    altBytes = [[13, 10]]
  }
  else if (encoding === 'utf16le' || encoding === 'ucs2') {
    switch (eol) {
      case 'lf':   eolBytes = [10, 0]; break
      case 'cr':   eolBytes = [13, 0]; break
      case 'crlf': eolBytes = [13, 0, 10, 0]; break
      case undefined:
      case 'nel':  eolBytes = [133, 0]; break
      default: throw new Error('Unrecognized EOL value ' + JSON.stringify(eol))
    }
    altBytes = [[40, 32], [41, 32]] // '\u2028', '\u2029'
  }
  else throw new Error('Unrecognized encoding ' + JSON.stringify(encoding))

  // 'Buffer.from()' variants supersede 'new Buffer()' as of node.js v6.0.0
  if (typeof Buffer.from === 'function')
    data.buffer = Buffer.from(data.buffer.toString('binary'), encoding)
  else
    data.buffer = new Buffer(data.buffer.toString('binary'), encoding)

  var altIdx
  var ln = 0
  var buf = data.buffer
  var lastPossible = buf.length - eolBytes.length
  for (var n = 0; n <= lastPossible; n++) {
    var noMatch = false
    for (var i = n, b = 0; b < eolBytes.length; i++, b++) {
      if (buf[i] != eolBytes[b]) { noMatch = true; break }
    }
    if (noMatch) continue

    data.lines[ln++].end = n

    if (varyEOLs && eol === 'nel') {
      altIdx = ln % (altBytes.length + 1)
      if (altIdx < altBytes.length) {
        buf[n] = altBytes[altIdx][0]
        buf[n+1] = altBytes[altIdx][1]
      }
    }
    if (ln < data.lines.length) data.lines[ln].start = i
    else break
  }
  if (ln < data.lines.length) data.lines[ln].end = buf.length
}


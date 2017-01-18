# stream2lines
A node.js module for extracting lines of text from a readable stream.

- Provides an EventEmitter, emitting `'readable'`, `'end'`, `'error'`, and `'close'`
- Each read() returns one entire line or null
- Allows setting limit on line length
- Allows closing/detaching from the source before it's fully consumed
- Allows choice of character set encoding
- Allows choice of end-of-line marker recognition
- Allows auto-destruction of source stream (where applicable)
- No dependencies

## Install

```sh
$ npm install stream2lines
```

## Usage
```js
var stream2lines = require('stream2lines');

var rs = getReadableStreamSomehow();
var pattern = /SECRET/i; // We're going to search for a matching line

var reader = stream2lines(rs) // Alternatively: stream2lines(rs, options)
  .once('error', function(err) {
    // Reader automatically closes. Maybe do something with err.
  })
  .on('readable', function() {
    var ln;
    while ((ln = this.read()) != null) {
      if (pattern.test(ln)) this.close() // Input stream can be dismissed early
      // Do something with line ln
    }
  })
  .once('end', function() {
    // No more lines. Do post-end things.
  })

```

#### Caveat
A reader instance provided by this module is an EventEmitter, _not_ a stream.
Although it has a stream-like API, it doesn't have every feature of streams.
Specifically, it can't be `pipe()`d to or from.

## API

### stream2lines(readable [, options])
Factory function. Returns a **stream2lines** LineReader instance.
- `readable` {stream.Readable} The source stream.
- `options` {Object} *Optional.*
  An object containing any of the following properties.  
  * **maxLineLength** {Number}  
  The upper limit on line length, in characters, not counting end-of-line marker.
  To allow unlimited string length, set this to 0.
  Must be a non-negative integer. Default: 4096 (4KB)

  * **autoDestroySource** {Boolean}  
  Setting this property `true` will lead to shutdown of a destructible source stream
  when the reader is closed, ensuring that its resources are released, even if the
  source stream was not configured for `autoClose`. If this property is set to `false`
  (default), the reader will not be involved in the destruction of the stream.

  * **encoding** {String}  
  The character set to use to decode bytes from the source stream. The choices are:  
    + `'ascii'`
    + `'latin1'` - 8-bit encoding **[Latin-1](https://en.wikipedia.org/wiki/ISO/IEC_8859-1)**,
      a.k.a. **[ISO 8859-1](https://en.wikipedia.org/wiki/ISO/IEC_8859-1)**
    + `'binary'` - to allow for a non-ISO-8859 8-bit encoding
      (such as **[Windows-1252](https://en.wikipedia.org/wiki/Windows-1252)**).  
      **Warning:** in recent versions of node.js, this is reduced to an alias
      for `'latin1'`.
    + `'utf8'` (default)
    + `'utf16le'`
    + `'ucs2'` - Alias for `'utf16le'`

    For further explanation of character encodings in node.js, see the
    [node.js Buffer API documentation](https://nodejs.org/dist/latest/docs/api/buffer.html#buffer_buffers_and_character_encodings).

  * **eolMatch** {String}  
  The end-of-line markers to recognize. The choices are:  
    + `'crlf'` or its equivalents `'dos'`, `'rfc2046'` - Match only '\r\n'
    + `'lf'` or its equivalents `'unix'`, `'linux'` - Match only '\n'
    + `'basic'` - Match only Unix/Linux, Windows/DOS, and Mac OS Classic EOL markers
    ('\n', '\r\n', and '\r', respectively)
    + `'7bit'` - Match everything that is safe to count as a line ending in strictly
    single-byte encodings ('\x85' is *not* safe)
    + `'iso8859'` - Match everything that `'7bit'` does, plus _NEXT LINE_
    (NEL, '\u0085')
    + `'all'` - Match everything that `'iso8859'` does, plus the Unicode-only EOL
    markers '\u2028' and '\u2029'

    Values in uppercase are also recognized.  
    The default `eolMatch` and invalid values depend on the chosen `encoding`:  
    | `encoding` | default `eolMatch` | invalid `eolMatch` values |
    |------------|--------------------|---------------------------|
     `'ascii'`   | `'7bit'`           | `'iso8859'`, `'all'`
     `'binary'`  | `'7bit'`           | `'iso8859'`, `'all'`
     `'latin1'`  | `'iso8859'`        | `'all'`
     `'utf8'`    | `'all'`            | 
     `'utf16le'` | `'all'`            | 
     `'ucs2'`    | `'all'`            | 

    If no options are given to the module function, the applied `eolMatch` will
    be `'all'`, because the default encoding is `'utf8'`.

### reader.read()
* Return {String} or `null`

Upon receiving the `'readable'` event, call this method in a loop to extract lines
until it returns `null`, which it will do until the next `'readable'` event, and
also do after the `'end'` event.
Any string returned will be an entire line, not including the end-of-line marker.

Caution: an empty line is returned as an empty string.

Note that this method does _not_ take an argument, unlike the
[stream.Readable method of the same name](https://nodejs.org/dist/latest/docs/api/stream.html#stream_readable_read_size).

### reader.lineCount()
* Return {Number}

This method tells you how many lines have been read _so far_. If called after
the `'end'` event, it tells the total. If called inside the `'error'` listener,
it tells the 1-indexed line number at which the error happened.

### reader.close()
Use this method to release resources / disengage from the source stream.
If `autoDestroySource` is set `true`, the source stream will also be closed and
destroyed; otherwise it can be used from the point where the reader left off,
which will be at the start of a line or at the end of the stream.

It will be redundant to call this if **both** of the following are true:
* `autoClose` is set in the source stream _or_ `autoDestroySource` is set `true`
  in the reader options;
* Either the `'end'` or `'error'` event is emitted.

### Event: 'readable'
Emitted when there is a line available to be read from the reader.
Unlike the [same-named event from stream.Readable](https://nodejs.org/dist/latest/docs/api/stream.html#stream_event_readable),
it is _not_ emitted after the final line is read.

### Event: 'end'
Emitted after the final line is `read()` from the reader.
Note that this can happen some number of reader `read()`s after the source stream
has been exhausted.

### Event: 'error'
* {Error}

Emitted when the source stream emits an error, or when the non-zero `maxLineLength`
is exceeded by the current line in the internal buffer. The current line can be
determined by using `this.lineCount()` inside the error listener callback.

The listener callback will be passed the `Error` object.

Note that the **error will be thrown** if there is no listener when an `'error'`
event is emitted.

### Event: 'close'
Emitted when the source stream emits `'close'`, or when the reader is `close()`d
early. If option `autoDestroySource` is set to `true`, the reader does not emit
its own `'close'` event until it receives `'close'` from the source stream.

Of course, the above only applies to source streams that publish a `'close'` event.


------

**License: MIT**


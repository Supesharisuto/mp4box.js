var MultiBufferStream = function() {
	/* List of ArrayBuffers, with a fileStart property, sorted in fileStart order and non overlapping */
	this.buffers = [];	
	this.bufferIndex = -1;
}
MultiBufferStream.prototype = new DataStream(new ArrayBuffer(), 0, DataStream.BIG_ENDIAN);

MultiBufferStream.prototype.initialized = function() {
	var firstBuffer;
	if (this.bufferIndex > -1) {
		return true;
	} else if (this.buffers.length > 0) {
		firstBuffer = this.buffers[0];
		if (firstBuffer.fileStart === 0) {
			this.buffer = firstBuffer;
			this.bufferIndex = 0;
			Log.d("MultiBufferStream", "Stream ready for parsing");
			return true;
		} else {
			Log.w("MultiBufferStream", "The first buffer should have a fileStart of 0");
			this.getBufferLevel();
			return false;
		}
	} else {
		Log.w("MultiBufferStream", "No buffer to start parsing from");
		this.getBufferLevel();
		return false;
	}			
}

/* helper functions to enable calling "open" with additional buffers */
ArrayBuffer.concat = function(buffer1, buffer2) {
  Log.d("ArrayBuffer", "Trying to create a new buffer of size: "+(buffer1.byteLength + buffer2.byteLength));
  var tmp = new Uint8Array(buffer1.byteLength + buffer2.byteLength);
  tmp.set(new Uint8Array(buffer1), 0);
  tmp.set(new Uint8Array(buffer2), buffer1.byteLength);
  return tmp.buffer;
};

/* Reduces the size of a given buffer */
MultiBufferStream.prototype.reduceBuffer = function(buffer, offset, newLength) {
	var smallB;
	smallB = new Uint8Array(newLength);
	smallB.set(new Uint8Array(buffer, offset, newLength));
	smallB.buffer.fileStart = buffer.fileStart+offset;
	smallB.buffer.usedBytes = 0;
	return smallB.buffer;	
}

/* insert the new buffer in the sorted list of buffers, 
   making sure, it is not overlapping with existing ones (possibly reducing its size).
   if the new buffer overrides/replaces the 0-th buffer (for instance because it is bigger), 
   updates the DataStream buffer for parsing */
MultiBufferStream.prototype.insertBuffer = function(ab) {	
	var to_add = true;
	/* TODO: improve insertion if many buffers */
	for (var i = 0; i < this.buffers.length; i++) {
		var b = this.buffers[i];
		if (ab.fileStart <= b.fileStart) {
			/* the insertion position is found */
			if (ab.fileStart === b.fileStart) {
				/* The new buffer overlaps with an existing buffer */
				if (ab.byteLength >  b.byteLength) {
					/* the new buffer is bigger than the existing one
					   remove the existing buffer and try again to insert 
					   the new buffer to check overlap with the next ones */
					this.buffers.splice(i, 1);
					i--; 
					continue;
				} else {
					/* the new buffer is smaller than the existing one, just drop it */
					Log.w("MultiBufferStream", "Buffer (fileStart: "+ab.fileStart+" - Length: "+ab.byteLength+") already appended, ignoring");
				}
			} else {
				/* The beginning of the new buffer is not overlapping with an existing buffer
				   let's check the end of it */
				if (ab.fileStart + ab.byteLength <= b.fileStart) {
					/* no overlap, we can add it as is */
				} else {
					/* There is some overlap, cut the new buffer short, and add it*/
					ab = this.reduceBuffer(ab, 0, b.fileStart - ab.fileStart);
				}
				Log.d("MultiBufferStream", "Appending new buffer (fileStart: "+ab.fileStart+" - Length: "+ab.byteLength+")");
				this.buffers.splice(i, 0, ab);
				/* if this new buffer is inserted in the first place in the list of the buffer, 
				   and the DataStream is initialized, make it the buffer used for parsing */
				if (i === 0) {
					this.buffer = ab;
				}
			}
			to_add = false;
			break;
		} else if (ab.fileStart < b.fileStart + b.byteLength) {
			/* the new buffer overlaps its beginning with the end of the current buffer */
			var offset = b.fileStart + b.byteLength - ab.fileStart;
			var newLength = ab.byteLength - offset;
			if (newLength > 0) {
				/* the new buffer is bigger than the current overlap, drop the overlapping part and try again inserting the remaining buffer */
				ab = this.reduceBuffer(ab, offset, newLength);
			} else {
				/* the content of the new buffer is entirely contained in the existing buffer, drop it entirely */
				to_add = false;
				break;
			}
		}
	}
	/* if the buffer has not been added, we can add it at the end */
	if (to_add) {
		Log.d("MultiBufferStream", "Appending new buffer (fileStart: "+ab.fileStart+" - Length: "+ab.byteLength+")");
		this.buffers.push(ab);
		/* if this new buffer is inserted in the first place in the list of the buffer, 
		   and the DataStream is initialized, make it the buffer used for parsing */
		if (i === 0) {
			this.buffer = ab;
		}
	}
}


MultiBufferStream.prototype.getBufferLevel = function() {
	var i;
	var buffer;
	var used, total;
	var ranges = [];
	var range;
	var bufferedString = "";
	used = 0;
	total = 0;
	for (i = 0; i < this.buffers.length; i++) {
		buffer = this.buffers[i];
		if (i === 0) {
			range = {};
			ranges.push(range);
			range.start = buffer.fileStart;
			range.end = buffer.fileStart+buffer.byteLength;
			bufferedString += range.start+"-";
		} else if (range.end === buffer.fileStart) {
			range.end = buffer.fileStart+buffer.byteLength;
		} else {
			bufferedString += range.end+", "+range.start+"-";
			range = {};
			ranges.push(range);
			range.start = buffer.fileStart;
			range.end = buffer.fileStart+buffer.byteLength;
		}
		used += buffer.usedBytes;
		total += buffer.byteLength;
	}
	if (ranges.length > 0) {
		bufferedString += range.end;
	}
	Log.i("MultiBufferStream", ""+this.buffers.length+" buffers ("+used+"/"+total+" bytes): "+bufferedString);
	this.cleanBuffers();
}

MultiBufferStream.prototype.cleanBuffers = function () {
	var i;
	var buffer;
	for (i = 0; i < this.buffers.length; i++) {
		buffer = this.buffers[i];
		if (buffer.usedBytes === buffer.byteLength) {
			Log.i("MultiBufferStream", "Removing buffer #"+i);
			this.buffers.splice(i, 1);
			i--;
		}
	}
}

MultiBufferStream.prototype.mergeNextBuffer = function() {
	var next_buffer;
	if (this.bufferIndex+1 < this.buffers.length) {
		next_buffer = this.buffers[this.bufferIndex+1];
		if (next_buffer.fileStart === this.buffer.fileStart + this.buffer.byteLength) {
			var oldLength = this.buffer.byteLength;
			var oldUsedBytes = this.buffer.usedBytes;
			var oldFileStart = this.buffer.fileStart;
			this.buffers[this.bufferIndex] = ArrayBuffer.concat(this.buffer, next_buffer);
			this.buffer = this.buffers[this.bufferIndex];
			this.buffers.splice(this.bufferIndex+1, 1);
			this.buffer.usedBytes = oldUsedBytes; /* TODO: should it be += ? */
			this.buffer.fileStart = oldFileStart;
			Log.d("ISOFile", "Concatenating buffer for box parsing (length: "+oldLength+"->"+this.buffer.byteLength+")");
			return true;
		} else {
			return false;
		}
	} else {
		return false;
	}
}

/* Searches for the buffer containing the given file position:
  - if found, repositions the parsing from there and returns true 
  - if not found, does not change anything and returns false */
MultiBufferStream.prototype.reposition = function(fromStart, filePosition, markAsUsed) {
	var index;
	index = this.findPosition(fromStart, filePosition, markAsUsed);
	if (index !== -1) {
		this.buffer = this.buffers[index];
		this.bufferIndex = index;
		this.position = filePosition - this.buffer.fileStart;
		Log.d("MultiBufferStream", "Repositioning parser at buffer position: "+this.position);
		return true;
	} else {
		Log.d("MultiBufferStream", "Position "+filePosition+" not found in buffered data");
		return false;
	}
}

/* Searches for the buffer containing the given file position
   Returns the index of the buffer (-1 if not found) */
MultiBufferStream.prototype.findPosition = function(fromStart, filePosition, markAsUsed) {
	var i;
	var abuffer = null;
	var index = -1;

	/* find the buffer with the largest position smaller than the given position */
	if (fromStart === true) {
	   /* the reposition can be in the past, we need to check from the beginning of the list of buffers */
		i = 0;
	} else {
		i = this.bufferIndex;
	}

	while (i < this.buffers.length) {
		abuffer = this.buffers[i];
		if (abuffer.fileStart <= filePosition) {
			index = i;
			if (markAsUsed) {
				if (abuffer.fileStart + abuffer.byteLength <= filePosition) {
					abuffer.usedBytes = abuffer.byteLength;	
				} else {
					abuffer.usedBytes = filePosition - abuffer.fileStart;
				}			
			}
		} else {
			break;
		}
		i++;
	}

	if (index !== -1) {
		abuffer = this.buffers[index];
		if (abuffer.fileStart + abuffer.byteLength >= filePosition) {			
			Log.d("MultiBufferStream", "Found position in existing buffer #"+index);
			return index;
		} else {
			return -1;
		}
	} else {
		return -1;
	}
}

MultiBufferStream.prototype.findEndContiguousBuf = function(inputindex) {
	var i;
	var currentBuf;
	var nextBuf;
	var index = inputindex || this.bufferIndex;
	currentBuf = this.buffers[index];
	/* find the end of the contiguous range of data */
	if (this.buffers.length > index+1) {
		for (i = index+1; i < this.buffers.length; i++) {
			nextBuf = this.buffers[i];
			if (nextBuf.fileStart === currentBuf.fileStart + currentBuf.byteLength) {
				currentBuf = nextBuf;
			} else {
				break;
			}
		}
	}
	/* return the position of last byte in the file that we have */
	return currentBuf.fileStart + currentBuf.byteLength;
}

MultiBufferStream.prototype.getPosition = function() {
	return this.position;
}

MultiBufferStream.prototype.getFilePosition = function() {
	return this.buffer.fileStart + this.position;
}

MultiBufferStream.prototype.addUsedBytes = function(nbBytes) {
	this.buffer.usedBytes += nbBytes;
}

MultiBufferStream.prototype.setAllUsedBytes = function() {
	this.buffer.usedBytes = this.buffer.byteLength;
}

MultiBufferStream.prototype.getEndFilePosition = function() {
	return this.buffer.fileStart + this.buffer.byteLength;
}

MultiBufferStream.prototype.getStartFilePosition = function() {
	return this.buffer.fileStart + this.buffer.byteLength;
}


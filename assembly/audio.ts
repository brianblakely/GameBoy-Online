// Audio.
export var XAudioJSWebAudioContextHandle: AudioContext;
var XAudioJSWebAudioAudioNode: ScriptProcessorNode | null = null;
var XAudioJSWebAudioLaunchedContext = false;
var XAudioJSAudioContextSampleBuffer: Float32Array = new Float32Array(0);
var XAudioJSResampledBuffer: Float32Array = new Float32Array(0);
var XAudioJSMinBufferSize = 15000;
var XAudioJSMaxBufferSize = 25000;
var XAudioJSChannelsAllocated = 1;
var XAudioJSVolume = 1;
var XAudioJSResampleControl: Resampler | null = null;
var XAudioJSAudioBufferSize = 0;
var XAudioJSResampleBufferStart = 0;
var XAudioJSResampleBufferEnd = 0;
var XAudioJSResampleBufferSize = 0;
var XAudioJSSamplesPerCallback = 2048; //Has to be between 2048 and 4096 (If over, then samples are ignored, if under then silence is added).

//JavaScript Audio Resampler (c) 2011 - Grant Galitz
class Resampler {
  fromSampleRate: number;
  toSampleRate: number;
  channels: number;
  outputBuffer: Float32Array;
  lastOutput: Float32Array;
  outputBufferSize: number;
  noReturn: boolean;
  resampler: Function;
  ratioWeight: number;
  lastWeight: number;
  tailExists: boolean;

  constructor(
    fromSampleRate: number,
    toSampleRate: number,
    channels: number,
    outputBufferSize: number,
    noReturn: boolean
  ) {
    this.fromSampleRate = fromSampleRate;
    this.toSampleRate = toSampleRate;
    this.channels = channels | 0;
    this.outputBufferSize = outputBufferSize;
    this.noReturn = !!noReturn;
    this.initialize();
  }

  initialize() {
    //Perform some checks:
    if (this.fromSampleRate > 0 && this.toSampleRate > 0 && this.channels > 0) {
      if (this.fromSampleRate == this.toSampleRate) {
        //Setup a resampler bypass:
        this.resampler = this.bypassResampler; //Resampler just returns what was passed through.
        this.ratioWeight = 1;
      } else {
        this.ratioWeight = this.fromSampleRate / this.toSampleRate;
        if (this.fromSampleRate < this.toSampleRate) {
          /*
          Use generic linear interpolation if upsampling,
          as linear interpolation produces a gradient that we want
          and works fine with two input sample points per output in this case.
        */
          this.compileLinearInterpolationFunction();
          this.lastWeight = 1;
        } else {
          /*
          Custom resampler I wrote that doesn't skip samples
          like standard linear interpolation in high downsampling.
          This is more accurate than linear interpolation on downsampling.
        */
          this.compileMultiTapFunction();
          this.tailExists = false;
          this.lastWeight = 0;
        }
        this.initializeBuffers();
      }
    } else {
      throw new Error("Invalid settings specified for the resampler.");
    }
  }

  compileLinearInterpolationFunction() {
    this.resampler = (buffer: Float32Array) => {
      var bufferLength = buffer.length;
      var outLength = this.outputBufferSize;
      if (bufferLength % this.channels == 0) {
        if (bufferLength > 0) {
          var weight = this.lastWeight;
          var firstWeight = 0;
          var secondWeight = 0;
          var sourceOffset = 0;
          var outputOffset = 0;
          var outputBuffer = this.outputBuffer;
          for (; weight < 1; weight += this.ratioWeight) {
            secondWeight = weight % 1;
            firstWeight = 1 - secondWeight;
            for (var channel = 0; channel < this.channels; ++channel) {
              outputBuffer[outputOffset++] =
                this.lastOutput[channel] * firstWeight +
                buffer[channel] * secondWeight;
            }
          }
          weight -= 1;
          for (
            bufferLength -= this.channels,
              sourceOffset = Math.floor(weight) * this.channels;
            outputOffset < outLength && sourceOffset < bufferLength;

          ) {
            secondWeight = weight % 1;
            firstWeight = 1 - secondWeight;
            for (var channel = 0; channel < this.channels; ++channel) {
              outputBuffer[outputOffset++] =
                buffer[sourceOffset + (channel > 0 ? channel : 0)] *
                  firstWeight +
                buffer[sourceOffset + (this.channels + channel)] * secondWeight;
            }
            weight += this.ratioWeight;
            sourceOffset = Math.floor(weight) * this.channels;
          }
          for (var channel = 0; channel < this.channels; ++channel) {
            this.lastOutput[channel] = buffer[sourceOffset++];
          }
          this.lastWeight = weight % 1;
          return this.bufferSlice(outputOffset);
        } else {
          return this.noReturn ? 0 : [];
        }
      } else {
        throw new Error("Buffer was of incorrect sample length.");
      }
    };
  }

  compileMultiTapFunction() {
    this.resampler = (buffer: Float32Array) => {
      var bufferLength = buffer.length;
      var outLength = this.outputBufferSize;
      var output = [];
      if (bufferLength % this.channels == 0) {
        if (bufferLength > 0) {
          var weight = 0;
          for (var channel = 0; channel < this.channels; ++channel) {
            output[channel] = 0;
          }
          var actualPosition = 0;
          var amountToNext = 0;
          var alreadyProcessedTail = !this.tailExists;
          this.tailExists = false;
          var outputBuffer = this.outputBuffer;
          var outputOffset = 0;
          var currentPosition = 0;
          do {
            if (alreadyProcessedTail) {
              weight = this.ratioWeight;
              for (channel = 0; channel < this.channels; ++channel) {
                output[channel] = 0;
              }
            } else {
              weight = this.lastWeight;
              for (channel = 0; channel < this.channels; ++channel) {
                output[channel] = this.lastOutput[channel];
              }
              alreadyProcessedTail = true;
            }
            while (weight > 0 && actualPosition < bufferLength) {
              amountToNext = 1 + actualPosition - currentPosition;
              if (weight >= amountToNext) {
                for (channel = 0; channel < this.channels; ++channel) {
                  output[channel] += buffer[actualPosition++] * amountToNext;
                }
                currentPosition = actualPosition;
                weight -= amountToNext;
              } else {
                for (channel = 0; channel < this.channels; ++channel) {
                  output[channel] +=
                    buffer[actualPosition + (channel > 0 ? channel : 0)] *
                    weight;
                }
                currentPosition += weight;
                weight = 0;
                break;
              }
            }
            if (weight <= 0) {
              for (channel = 0; channel < this.channels; ++channel) {
                outputBuffer[outputOffset++] =
                  output[channel] / this.ratioWeight;
              }
            } else {
              this.lastWeight = weight;
              for (channel = 0; channel < this.channels; ++channel) {
                this.lastOutput[channel] = output[channel];
              }
              this.tailExists = true;
              break;
            }
          } while (actualPosition < bufferLength && outputOffset < outLength);
          return this.bufferSlice(outputOffset);
        } else {
          return this.noReturn ? 0 : [];
        }
      } else {
        throw new Error("Buffer was of incorrect sample length.");
      }
    };
  }

  bypassResampler(buffer: Float32Array) {
    if (this.noReturn) {
      //Set the buffer passed as our own, as we don't need to resample it:
      this.outputBuffer = buffer;
      return buffer.length;
    } else {
      //Just return the buffer passsed:
      return buffer;
    }
  }

  bufferSlice(sliceAmount: number) {
    if (this.noReturn) {
      //If we're going to access the properties directly from this object:
      return sliceAmount;
    } else {
      return this.outputBuffer.subarray(0, sliceAmount);
    }
  }

  initializeBuffers() {
    //Initialize the internal buffer:
    try {
      this.outputBuffer = new Float32Array(this.outputBufferSize);
      this.lastOutput = new Float32Array(this.channels);
    } catch (error) {
      this.outputBuffer = new Float32Array(0);
      this.lastOutput = new Float32Array(0);
    }
  }
}

//2010-2013 Grant Galitz - XAudioJS realtime audio output compatibility library:
export class XAudioServer {
  XAudioJSSampleRate: number;
  underRunCallback: Function;
  failureCallback: Function;
  samplesAlreadyWritten: number;
  audioType: number;
  audioHandleMediaStream: HTMLAudioElement;

  constructor(
    channels: number,
    sampleRate: number,
    minBufferSize: number,
    maxBufferSize: number,
    volume: number,
    underRunCallback?: Function,
    failureCallback?: Function
  ) {
    XAudioJSChannelsAllocated = Math.max(channels, 1);
    this.XAudioJSSampleRate = Math.abs(sampleRate);
    XAudioJSMinBufferSize =
      minBufferSize >= XAudioJSSamplesPerCallback * XAudioJSChannelsAllocated &&
      minBufferSize < maxBufferSize
        ? minBufferSize & -XAudioJSChannelsAllocated
        : XAudioJSSamplesPerCallback * XAudioJSChannelsAllocated;
    XAudioJSMaxBufferSize =
      Math.floor(maxBufferSize) >
      XAudioJSMinBufferSize + XAudioJSChannelsAllocated
        ? maxBufferSize & -XAudioJSChannelsAllocated
        : XAudioJSMinBufferSize * XAudioJSChannelsAllocated;
    this.underRunCallback =
      typeof underRunCallback == "function" ? underRunCallback : function() {};
    XAudioJSVolume = volume >= 0 && volume <= 1 ? volume : 1;
    this.failureCallback =
      typeof failureCallback == "function"
        ? failureCallback
        : function() {
            throw new Error("XAudioJS has encountered a fatal error.");
          };
    this.initializeAudio();
  }

  callbackBasedWriteAudioNoCallback(buffer: Float32Array) {
    //Callback-centered audio APIs:
    var length = buffer.length;
    for (
      var bufferCounter = 0;
      bufferCounter < length && XAudioJSAudioBufferSize < XAudioJSMaxBufferSize;

    ) {
      XAudioJSAudioContextSampleBuffer[XAudioJSAudioBufferSize++] =
        buffer[bufferCounter++];
    }
  }

  /*Pass your samples into here!
Pack your samples as a one-dimenional array
With the channel samples packed uniformly.
examples:
    mono - [left, left, left, left]
    stereo - [left, right, left, right, left, right, left, right]
*/
  writeAudio(buffer: Float32Array) {
    switch (this.audioType) {
      case 1:
      case 3:
        this.callbackBasedWriteAudioNoCallback(buffer);
        this.callbackBasedExecuteCallback();
        break;
      default:
        this.failureCallback();
    }
  }

  /*Pass your samples into here if you don't want automatic callback calling:
Pack your samples as a one-dimenional array
With the channel samples packed uniformly.
examples:
    mono - [left, left, left, left]
    stereo - [left, right, left, right, left, right, left, right]
Useful in preventing infinite recursion issues with calling writeAudio inside your callback.
*/
  writeAudioNoCallback(buffer: Float32Array) {
    switch (this.audioType) {
      case 1:
      case 3:
        this.callbackBasedWriteAudioNoCallback(buffer);
        break;
      default:
        this.failureCallback();
    }
  }

  //Developer can use this to see how many samples to write (example: minimum buffer allotment minus remaining samples left returned from this function to make sure maximum buffering is done...)
  //If null is returned, then that means metric could not be done.
  remainingBuffer() {
    switch (this.audioType) {
      case 1:
      case 3:
        return (
          Math.floor(
            (XAudioJSResampledSamplesLeft() *
              (XAudioJSResampleControl !== null
                ? XAudioJSResampleControl.ratioWeight
                : 0)) /
              XAudioJSChannelsAllocated
          ) *
            XAudioJSChannelsAllocated +
          XAudioJSAudioBufferSize
        );
      default:
        this.failureCallback();
        return 0;
    }
  }

  callbackBasedExecuteCallback() {
    //WebKit /Flash Audio:
    var samplesRequested = XAudioJSMinBufferSize - this.remainingBuffer();
    if (samplesRequested > 0) {
      this.callbackBasedWriteAudioNoCallback(
        this.underRunCallback(samplesRequested)
      );
    }
  }

  //If you just want your callback called for any possible refill (Execution of callback is still conditional):
  executeCallback() {
    switch (this.audioType) {
      case 1:
      case 3:
        this.callbackBasedExecuteCallback();
        break;
      default:
        this.failureCallback();
    }
  }

  //DO NOT CALL THIS, the lib calls this internally!
  initializeAudio() {
    try {
      this.initializeWebAudio();
    } catch (error) {
      this.audioType = -1;
      this.failureCallback();
    }
  }

  disconnect() {
    if (XAudioJSWebAudioAudioNode instanceof ScriptProcessorNode) {
      XAudioJSWebAudioAudioNode.disconnect(0);
    }
  }

  initializeWebAudio() {
    if (!XAudioJSWebAudioLaunchedContext) {
      try {
        XAudioJSWebAudioContextHandle = new AudioContext(); //Create a system audio context.
      } catch (error) {
        XAudioJSWebAudioContextHandle = new (<any>window).webkitAudioContext(); //Create a system audio context.
      }
      XAudioJSWebAudioLaunchedContext = true;
    }

    if (XAudioJSWebAudioAudioNode instanceof ScriptProcessorNode) {
      XAudioJSWebAudioAudioNode.disconnect();
      XAudioJSWebAudioAudioNode.onaudioprocess = null;
      XAudioJSWebAudioAudioNode = null;
    }

    XAudioJSWebAudioAudioNode = XAudioJSWebAudioContextHandle.createScriptProcessor(
      XAudioJSSamplesPerCallback,
      0,
      XAudioJSChannelsAllocated
    );

    XAudioJSWebAudioAudioNode.onaudioprocess = XAudioJSWebAudioEvent; //Connect the audio processing event to a handling function so we can manipulate output
    XAudioJSWebAudioAudioNode.connect(
      XAudioJSWebAudioContextHandle.destination
    ); //Send and chain the output of the audio manipulation to the system audio output.
    this.resetCallbackAPIAudioBuffer(XAudioJSWebAudioContextHandle.sampleRate);
    this.audioType = 1;
  }

  changeVolume(newVolume: number) {
    if (newVolume >= 0 && newVolume <= 1) {
      XAudioJSVolume = newVolume;
      switch (this.audioType) {
        case 1:
          break;
        case 3:
          this.audioHandleMediaStream.volume = XAudioJSVolume;
          break;
        default:
          this.failureCallback();
      }
    }
  }

  //Set up the resampling:
  resetCallbackAPIAudioBuffer(APISampleRate: number) {
    XAudioJSAudioBufferSize = XAudioJSResampleBufferEnd = XAudioJSResampleBufferStart = 0;
    this.initializeResampler(APISampleRate);
    XAudioJSResampledBuffer = new Float32Array(XAudioJSResampleBufferSize);
  }

  initializeResampler(sampleRate: number) {
    XAudioJSAudioContextSampleBuffer = new Float32Array(XAudioJSMaxBufferSize);
    XAudioJSResampleBufferSize = Math.max(
      XAudioJSMaxBufferSize * Math.ceil(sampleRate / this.XAudioJSSampleRate) +
        XAudioJSChannelsAllocated,
      XAudioJSSamplesPerCallback * XAudioJSChannelsAllocated
    );
    XAudioJSResampleControl = new Resampler(
      this.XAudioJSSampleRate,
      sampleRate,
      XAudioJSChannelsAllocated,
      XAudioJSResampleBufferSize,
      true
    );
  }
}

function XAudioJSWebAudioEvent(event: AudioProcessingEvent) {
  //Find all output channels:
  for (
    var bufferCount = 0, buffers = [];
    bufferCount < XAudioJSChannelsAllocated;
    ++bufferCount
  ) {
    buffers[bufferCount] = event.outputBuffer.getChannelData(bufferCount);
  }
  //Make sure we have resampled samples ready:
  XAudioJSResampleRefill();
  //Copy samples from XAudioJS to the Web Audio API:
  for (
    var index = 0;
    index < XAudioJSSamplesPerCallback &&
    XAudioJSResampleBufferStart != XAudioJSResampleBufferEnd;
    ++index
  ) {
    for (
      bufferCount = 0;
      bufferCount < XAudioJSChannelsAllocated;
      ++bufferCount
    ) {
      buffers[bufferCount][index] =
        XAudioJSResampledBuffer[XAudioJSResampleBufferStart++] * XAudioJSVolume;
    }
    if (XAudioJSResampleBufferStart == XAudioJSResampleBufferSize) {
      XAudioJSResampleBufferStart = 0;
    }
  }
  //Pad with silence if we're underrunning:
  while (index < XAudioJSSamplesPerCallback) {
    for (
      bufferCount = 0;
      bufferCount < XAudioJSChannelsAllocated;
      ++bufferCount
    ) {
      buffers[bufferCount][index] = 0;
    }
    ++index;
  }
}

function XAudioJSResampleRefill() {
  if (XAudioJSAudioBufferSize > 0) {
    //Resample a chunk of audio:
    var resampleLength =
      XAudioJSResampleControl !== null
        ? XAudioJSResampleControl.resampler(XAudioJSGetBufferSamples())
        : 0;
    var resampledResult =
      XAudioJSResampleControl !== null
        ? XAudioJSResampleControl.outputBuffer
        : new Float32Array(0);
    for (var index2 = 0; index2 < resampleLength; ) {
      XAudioJSResampledBuffer[XAudioJSResampleBufferEnd++] =
        resampledResult[index2++];
      if (XAudioJSResampleBufferEnd == XAudioJSResampleBufferSize) {
        XAudioJSResampleBufferEnd = 0;
      }
      if (XAudioJSResampleBufferStart == XAudioJSResampleBufferEnd) {
        XAudioJSResampleBufferStart += XAudioJSChannelsAllocated;
        if (XAudioJSResampleBufferStart == XAudioJSResampleBufferSize) {
          XAudioJSResampleBufferStart = 0;
        }
      }
    }
    XAudioJSAudioBufferSize = 0;
  }
}
function XAudioJSResampledSamplesLeft() {
  return (
    (XAudioJSResampleBufferStart <= XAudioJSResampleBufferEnd
      ? 0
      : XAudioJSResampleBufferSize) +
    XAudioJSResampleBufferEnd -
    XAudioJSResampleBufferStart
  );
}
function XAudioJSGetBufferSamples() {
  return XAudioJSGetArraySlice(
    XAudioJSAudioContextSampleBuffer,
    XAudioJSAudioBufferSize
  );
}
function XAudioJSGetArraySlice(buffer: Float32Array, lengthOf: number) {
  return buffer.subarray(0, lengthOf);
}

import loader from "@assemblyscript/loader";

// import { RenderingBuffer } from "./platform/rendering";

let renderingBuffer;

const imports = {
  console: {
    debug: msgPtr => {
      process.env.NODE_ENV === `development` &&
        console.debug(core.__getString(msgPtr));
    },
    info: msgPtr => {
      process.env.NODE_ENV === `development` &&
        console.info(core.__getString(msgPtr));
    },
    warn: msgPtr => {
      process.env.NODE_ENV === `development` &&
        console.warn(core.__getString(msgPtr));
    },
    error: msgPtr => {
      process.env.NODE_ENV === `development` &&
        console.error(core.__getString(msgPtr));
    }
  },
  renderingBuffer: {
    set: bufferPtr =>
      renderingBuffer.setBuffer(core.__getUint8ClampedArray(bufferPtr))
  }
};

/*`loader.instantiate` will use `WebAssembly.instantiateStreaming`
   if possible. Overwise fallback to `WebAssembly.instantiate`. */
const core = loader.instantiateSync(fetch(`optimized.wasm`), imports);

import loader from "@assemblyscript/loader";

const imports = {
  console: {
    debug: msgPtr => {
      process.env.NODE_ENV === `development` &&
        console.debug(core.getString(msgPtr));
    },
    info: msgPtr => {
      process.env.NODE_ENV === `development` &&
        console.info(core.getString(msgPtr));
    },
    warn: msgPtr => {
      process.env.NODE_ENV === `development` &&
        console.warn(core.getString(msgPtr));
    },
    error: msgPtr => {
      process.env.NODE_ENV === `development` &&
        console.error(core.getString(msgPtr));
    }
  }
};

/*`loader.instantiate` will use `WebAssembly.instantiateStreaming`
   if possible. Overwise fallback to `WebAssembly.instantiate`. */
let core;
loader
  .instantiate(fetch(`optimized.wasm`), imports)
  .then(module => (core = module));

export default core;

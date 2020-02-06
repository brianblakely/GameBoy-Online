import loader from "@assemblyscript/loader";

(async function main() {
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
  const core = await loader.instantiate(fetch(`optimized.wasm`), imports);
})();

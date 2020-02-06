import loader from "@assemblyscript/loader";

const myImports = { ... }

/*`loader.instantiate` will use `WebAssembly.instantiateStreaming`
   if possible. Overwise fallback to `WebAssembly.instantiate`. */
const core = await loader.instantiate(
  fetch("optimized.wasm"),
  myImports
)

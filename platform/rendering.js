// Get and set graphics buffer.

const GBWIDTH = 160;
const GBHEIGHT = 144;

export class RenderingBuffer {
  constructor(canvas) {
    canvas.width = GBWIDTH;
    canvas.height = GBHEIGHT;
    canvas.style.imageRendering = `-moz-crisp-edges`;
    canvas.style.imageRendering = `-webkit-crisp-edges`;
    canvas.style.imageRendering = `pixelated`;
    canvas.style.imageRendering = `crisp-edges`;

    this.drawContext = canvas.getContext(`2d`);
  }

  setBuffer(buffer) {
    this.drawContext.putImageData(
      new ImageData(buffer, GBWIDTH, GBHEIGHT),
      0,
      0
    );
  }
}

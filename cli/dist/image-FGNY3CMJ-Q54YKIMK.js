// ../repl/dist/image-FGNY3CMJ.js
async function getSharp() {
  try {
    return (await import("sharp")).default;
  } catch {
    throw new Error("sharp is required for image operations. Install with: pnpm add sharp");
  }
}
var imageModule = {
  id: "image",
  description: "Image operations (requires sharp)",
  functions: [
    {
      name: "imageResize",
      description: "Resize image",
      signature: "(src: string, dest: string, options: { width?: number, height?: number }) => Promise<void>",
      fn: async (src, dest, options) => {
        const sharp = await getSharp();
        const opts = options;
        await sharp(src).resize(opts.width, opts.height).toFile(dest);
      }
    },
    {
      name: "imageCrop",
      description: "Crop image",
      signature: "(src: string, dest: string, region: { left: number, top: number, width: number, height: number }) => Promise<void>",
      fn: async (src, dest, region) => {
        const sharp = await getSharp();
        await sharp(src).extract(region).toFile(dest);
      }
    },
    {
      name: "imageConvert",
      description: "Convert image format",
      signature: "(src: string, dest: string, format: 'png' | 'jpg' | 'webp') => Promise<void>",
      fn: async (src, dest, format) => {
        const sharp = await getSharp();
        await sharp(src).toFormat(format).toFile(dest);
      }
    },
    {
      name: "imageInfo",
      description: "Image metadata",
      signature: "(src: string) => Promise<{ width: number, height: number, format: string, size: number }>",
      fn: async (src) => {
        const sharp = await getSharp();
        const meta = await sharp(src).metadata();
        return { width: meta.width, height: meta.height, format: meta.format, size: meta.size };
      }
    }
  ]
};
var image_default = imageModule;
export {
  image_default as default
};

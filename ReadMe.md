## Scalable GPU text rendering implementation

Based on [this article](https://medium.com/@evanwallace/easy-scalable-text-rendering-on-the-gpu-c3f4d782c5ac) written by Evan Wallace.

[Demo](https://devoln.github.io/scalable-webgl-text)

### Implements:

1. rough glyph polygon rendering using odd-even rule
2. glyph quadratic Bézier curve rendering
3. grayscale antialiasing
4. subpixel antialiasing

## Note

To see font subpixel antialiasing properly, zoom the page to get 1:1 canvas to display pixel mapping.
For example, if your OS doesn't use any DPI scaling for your monitor, set the page zoom to 100%.
If your OS is set to 200% DPI scale, zoom the page to 50%.

Otherwise, the text will be scaled.

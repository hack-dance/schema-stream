# Schema Stream Demo Video

This HyperFrames composition is the single source for the product demo used by the documentation
homepage and GitHub README.

## Outputs

- `docs/assets/schema-stream-demo.mp4`: 1920x1080, 30 fps docs video
- `docs/assets/schema-stream-demo.gif`: 1280x720, 15 fps README loop
- `docs/assets/schema-stream-demo-poster.jpg`: accessible video poster

`bun run docs:prepare` copies all three canonical assets into the ignored site staging directory.

## Workflow

```bash
bun run demo:check
bun run demo:render
```

`demo:render` runs strict HyperFrames checks, renders the MP4 once, derives the optimized GIF and
poster with FFmpeg, and prints the final video metadata. Edit the composition, design brief, and
storyboard together so the public media stays aligned with product behavior.

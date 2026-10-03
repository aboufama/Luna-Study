# Mosaic stage architecture

The stage now has a content-aware layout and a reusable tile-scene compiler. It
is a frontend foundation for an assistant-directed environment. The live model
protocol still controls whiteboard content and visibility; it does not yet send
mosaic scenes or define arbitrary interactive demos.

## What changed

Previously, `VoiceCanvas.jsx` interpolated every stone between two arrangements:
the central tutor medallion and a fixed frame around most of the viewport. The
whiteboard used an independently sized, centered content column. Opening a small
equation used the same frame as opening a large matrix, and all stones entered
the frame, leaving no visible tutor circle.

The new flow separates content measurement, layout, allocation, and movement:

1. `Whiteboard.jsx` measures `.board-flow`, the natural size of the rendered
   content at the viewport's allowed width. It observes content and font changes.
   It does not measure its containing frame as input to that frame's size.
2. `main.jsx` associates that measurement with the board revision and passes it
   to `VoiceCanvas.jsx`. Identical measurements preserve the previous state.
3. `measureStageLayout()` computes shared frame, content, tutor, captions, and
   dock geometry in CSS pixels. Content grows the board until the available
   viewport bounds require scrolling.
4. `createMosaicStageTargets()` assembles the entire pool into the frame, using
   two to four courses. A patch of the lower-right corner remains the tutor's
   presence. The minimum board footprint follows the space needed by the
   full-size stones, rather than squeezing them into a separate avatar.
5. `compileMosaicScene()` converts the composition into one pose per original
   tile, in original tile order.
6. `createMosaicTargetMotion()` eases changed poses to their new destinations.
   Existing circle-to-stage choreography remains responsible for opening and
   closing the board. The renderer retains the cached stone atlas, voice
   choreography, pointer response, and document intake behavior.

The production field currently contains 1,010 deterministic stones. Their IDs
and polygon vertices remain stable. Every stone keeps its original size in CSS
pixels, including in the main tutor, whiteboard frame, corner tutor, transitions,
and viewport resizing. Tile size does not depend on a group's radius or the
viewport width. The stage has no detached tutor circle. Every stone contributes
to the frame, and the tutor's corner has a slightly richer tone that responds
to speech without rotating out of the frame. The frame uses consistent quiet
lighting instead of inheriting the medallion's dark center and faded edge.
The corner presence is a keyboard-accessible button that returns to the voice
view without stopping the voice session. Its hit area follows the two frame
edges, leaving the teaching content unobstructed. Cramped viewports can scroll
when the complete stone pool cannot fit at its native size.

## Local scene primitive

`src/mosaic-stage.mjs` exports:

```js
measureStageLayout({ width, height, contentWidth, contentHeight, unit })
createMosaicStageTargets(tiles, layout)
compileMosaicScene(tiles, scene)
```

`compileMosaicScene` accepts a versioned, serializable scene:

```js
const scene = {
  version: 1,
  unit: 1,
  groups: [
    {
      id: 'board',
      role: 'board',
      tileIds: ['stone-20', 'stone-21', 'stone-22'],
      shape: {
        type: 'path',
        points: [{ x: 120, y: 100 }, { x: 360, y: 100 }],
      },
    },
    {
      id: 'tutor',
      role: 'tutor',
      // Omitting tileIds claims the unassigned remainder.
      shape: { type: 'circle', x: 400, y: 340, radius: 160 },
    },
  ],
};

const compiled = compileMosaicScene(tiles, scene);
// compiled.targets preserves original tile order:
// { id, role, groupId, x, y, rotation, scale }
```

Tile IDs may be strings or finite numbers. Tiles without an explicit ID use
their original index. A tile can belong to only one group; at most one group
can claim the remainder. Unassigned tiles retain their source poses. Group IDs
must be unique. The compiler rejects unknown tile IDs and invalid geometry.
The source unit is fixed at 1. Explicit tile scales must also be 1.

Supported shapes are:

| Shape | Required fields | Behavior |
| --- | --- | --- |
| `frame` | `x`, `y`, `width`, `height` | Arranges stones in rounded rectangular courses. Optional `pitch`, `courses`, and `cornerRadius`. |
| `circle` | `x`, `y`, `radius` | Translates the selected source arrangement without resizing stones. The radius must contain the selected geometry. |
| `path` | `points: [{x, y}, …]` | Distributes stones along a polyline in the supplied tile-ID order. Optional `closed`. |
| `poses` | `poses: [{x, y, rotation?, scale?}, …]` | Supplies one explicit pose per selected tile. Scale may be omitted or set to 1. |

Coordinates are CSS pixels; every output pose keeps `scale: 1`. `circle`
preserves the selected stones' original arrangement and dimensions, so an
arbitrary sparse selection does not automatically become a densely filled disc.
The production allocator marks stones at the frame's lower-right corner as
the tutor while preserving their positions in the frame.

The current compiler supports up to 20,000 tiles, 64 groups, and 1,024 points per
path, with finite bounded coordinates. It creates destinations only. Rendering
styles, polygon editing, hit targets, and simulation behavior are separate
concerns and are not part of this primitive yet.

## Retargeting

```js
const motion = createMosaicTargetMotion(tiles.length);
motion.setTargets(compiled.targets); // First assignment is immediate.
motion.setTargets(nextScene.targets); // Keeps current positions and velocities.
const poses = motion.step(deltaMilliseconds, prefersReducedMotion);
```

The motion engine reuses its output array and each pose object. It takes the
shortest rotation path, finishes each changed tile within 600 ms, and ignores
repeated equivalent targets. Explicit `{ immediate: true }` and reduced motion
settle directly. Inputs are validated before any state changes and are not
mutated or retained. Scale is fixed at 1 and is never animated. Any target with
an explicit scale other than 1 is rejected before it can change the scene.

`role` and `id` update immediately. `tutorMix` interpolates between 0 and 1 so
lighting can move between frame and tutor behavior. Its default
is 1 for the `tutor` role and 0 otherwise. The motion output keeps rendering pose
fields; group metadata remains available on the compiled scene.

## What the live API can control today

The server still accepts the existing `<board>` protocol through
`server/tutor-output.mjs` and applies updates through `server/whiteboard.mjs`.
It can create, patch, replace, and remove identified whiteboard blocks, decide
when to show the board, and receive revision-checked interaction selections.

The accepted block types are text, LaTeX, matrices, and diagrams. The live voice
path uses visual-only updates, which filter plain text blocks. A single update
can contain up to six blocks and a stored board up to twelve. Matrices support
up to twelve rows and twelve columns. Diagrams allow a total of thirty basic
line, arrow, rectangle, circle, and text primitives. Authored interaction zones
support clicks, keyboard activation, and multiple selection.

The model cannot currently choose the mosaic's tile positions, layout groups,
colors, per-tile opacity, or shape vertices. It cannot create a slider, draggable
object, simulation, custom renderer, or executable demo through this protocol.
The new local scene compiler is not connected to a server message, a model tool,
or persisted scene state. A successful frontend layout test does not imply those
capabilities exist.

## Path to a fully assistant-directed stage

The next layer should be a shared, versioned scene protocol with stable object
IDs and explicit commands to add, update, remove, group, and reorder objects.
Each scene should have a revision so stale updates and interactions can be
handled like the current board selections. The server and client should use
the same schema and persist the accepted scene for restoration.

A renderer registry can then provide equations, whiteboards, plots, paths,
controls, and interactive demonstrations as composable object types. Each type
needs declared properties, intrinsic measurement, an accessible DOM surface,
and interaction events. For example, a slider should emit its object ID,
revision, and numeric value; dragging should report an object's proposed
position. The model can update scene state in response, while local interaction
remains responsive between model turns.

Mosaic tile groups can decorate or form those objects through the same scene
compiler. Explicit poses already provide a low-level destination for each
stone. Additional properties such as opacity or color require matching schema,
transition, and renderer support. Text, equations, and controls should retain
their semantic renderers and interaction surfaces, even when stones supply
their surrounding form.

Arbitrary new executable demos need a separate execution and lifecycle design;
they are not enabled by accepting a new shape string. Extending the typed object
registry first provides a concrete route to increasingly capable scenes while
preserving selection, keyboard access, resize behavior, reduced motion, and
reliable state restoration.

## Verification

The focused unit suites are `tests/mosaic-stage.test.mjs` and
`tests/mosaic-target-motion.test.mjs`. They cover allocation conservation,
deterministic IDs, layout bounds, supported scene shapes, validation,
nonmutation, constant tile size, atomic rejection of scale changes, retarget
continuity, shortest rotations, and reduced motion.

`tests/mosaic-stage-browser.mjs` exercises the integrated whiteboard with mocked
provider requests, voice socket, microphone, and audio. Its cases include a
small equation, a large matrix, responsive layouts, local overflow, selection
retention, tutor presence, rapid visibility changes, and reduced motion. Run it
against a separately started local application. Run `npm run check` for the
project's complete unit and production-build gate.

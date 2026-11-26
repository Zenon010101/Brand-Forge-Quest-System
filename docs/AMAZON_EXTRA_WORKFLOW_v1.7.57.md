# Amazon Extras v1.7.57 - Workflow / architecture

### Main Image 1 + Creative Image 2

Select source images for each Amazon ID and put the desired main product image first. Optionally choose one Creative file using the global Amazon extras panel and enable `Auto Creative as Image #2`. The main process transforms `[selected1, selected2, ...]` into `[selected1, creative, selected2, ...]` for each primary ID, with an eight-image total maximum. Shared IDs reuse the same finished sequence. The master PSD receives the same layered order.

The creative is a separately selected source file; it is not copied as an already finished 1001px JPEG, so normal Amazon rendering/canvas rules apply. The option is disabled unless an image is selected.

### RK Plain after successful Amazon

The optional RK Plain post-generation step identifies successful **primary/main** IDs and their first *finished* Amazon JPG. It locates exactly one matching marker directory beneath a linked brand root (SINGLE -> RAKUTEN/RAKUEN -> directory including RAK and PLAIN -> `PLAIN.psd`) or prompts the user to pick a directory containing the marker. It copies the finished JPEG's bytes as `{id}plain.jpg`, lowercase ID, with existing-file checks and transactional publish; it never edits `PLAIN.psd`. The copy's dimensions are exactly the Amazon Image #1 dimensions.

### Why Photoshop kept opening in unassigned PSD views

Before v1.7.57, each PSD library thumbnail requested a general preview IPC that could invoke Photoshop, even if the image was unassigned. Scrolling and filtering could schedule large pending queues. Now the UI requires explicit click-to-preview for PSD/PSB and other Photoshop-only types; automatic JPG/PNG/WEBP thumbnails are Sharp-only and never use Photoshop. Filter/list changes invalidate pending thumbnail tasks. Actual processing of a chosen PSD still uses Photoshop on a cache miss, or uses v1.7.56's persistent PSD Fast Loader on a hit.

### Boundaries

- Clear Amazon resets in-memory UI state only. It does not clear the filesystem or Photoshop cache.
- RK Plain saves to the folder containing `PLAIN.psd`, not into the PSD document.
- A Creative takes one of the eight Amazon slots and does not silently remove user-selected images.
- This release does not change Original Amazon image geometry, Colorbox behavior, or Slider PSD processing.

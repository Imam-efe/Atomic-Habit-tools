export const springs = {
  snappy: { type: 'spring' as const, stiffness: 400, damping: 28, mass: 1 },
  smooth: { type: 'spring' as const, stiffness: 280, damping: 32, mass: 1 },
  bouncy: { type: 'spring' as const, stiffness: 500, damping: 20, mass: 1 },
  gentle: { type: 'spring' as const, stiffness: 200, damping: 30, mass: 1 },
  firm: { type: 'spring' as const, stiffness: 350, damping: 40, mass: 1 },
  roll: { type: 'spring' as const, stiffness: 300, damping: 26, mass: 1 },
  nav: { type: 'spring' as const, stiffness: 380, damping: 36, mass: 1 },
};

/**
 * Neumorphic surfaces communicate by depth, so taps scale far less than they
 * would on a flat card — the shadow swap carries the feedback instead. Pair
 * these with `whileTap` and the `.neu-press` class.
 */
export const press = {
  /** Cards and list rows. */
  surface: { scale: 0.985 },
  /** Chips, icon buttons, tab items. */
  control: { scale: 0.94 },
};

export const duration = {
  micro: 0.15,
  component: 0.32,
  screen: 0.4,
  celebration: 0.6,
};

/**
 * Screen-level transitions are tweened, not sprung.
 *
 * A spring on a full screen overshoots, and an overshoot the size of the
 * viewport reads as lag rather than bounce. A short ease-out curve gets the
 * incoming screen to its resting position fast and settles without wobble.
 *
 * Only `opacity` and `transform` appear here. Both are composited, so the whole
 * transition runs off the main thread and holds frame rate on a 120Hz panel
 * even while the incoming screen is still mounting.
 */
export const screenTransition = {
  /** easeOutQuint — most of the travel happens in the first third. */
  ease: [0.22, 1, 0.36, 1] as const,
  enter: 0.26,
  /** Shorter than the enter so the two crossfade instead of queueing. */
  exit: 0.16,
};

/**
 * Expand/collapse panels.
 *
 * `height: auto` is a layout animation — the browser reflows the panel and
 * everything below it once per frame. A spring makes that worse than it sounds:
 * it settles over ~550ms and spends the tail of that doing a full reflow per
 * frame to move a couple of pixels. A short tween covers the same distance in
 * less than half the frames, which is why the panels feel like they snap open
 * rather than drag.
 */
export const collapse = {
  type: 'tween' as const,
  duration: 0.22,
  ease: [0.32, 0.72, 0, 1] as const,
};

export const screenVariants = {
  initial: { opacity: 0, y: 8, scale: 0.994 },
  animate: { opacity: 1, y: 0, scale: 1 },
  exit: { opacity: 0, y: -6, scale: 1.004 },
};

export const springs = {
  snappy: { type: 'spring' as const, stiffness: 400, damping: 28, mass: 1 },
  smooth: { type: 'spring' as const, stiffness: 280, damping: 32, mass: 1 },
  bouncy: { type: 'spring' as const, stiffness: 500, damping: 20, mass: 1 },
  gentle: { type: 'spring' as const, stiffness: 200, damping: 30, mass: 1 },
  firm: { type: 'spring' as const, stiffness: 350, damping: 40, mass: 1 },
  roll: { type: 'spring' as const, stiffness: 300, damping: 26, mass: 1 },
  nav: { type: 'spring' as const, stiffness: 380, damping: 36, mass: 1 },
};

export const duration = {
  micro: 0.15,
  component: 0.32,
  screen: 0.4,
  celebration: 0.6,
};

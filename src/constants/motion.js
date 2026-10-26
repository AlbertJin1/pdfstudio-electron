// Shared motion presets keep transitions coherent across the whole desktop UI.
export const pageVariants = {
  initial: { opacity: 0, y: 10, scale: 0.997 },
  animate: { opacity: 1, y: 0, scale: 1, transition: { duration: 0.22, ease: [0.22, 1, 0.36, 1] } },
  exit: { opacity: 0, y: -5, scale: 0.999, transition: { duration: 0.13, ease: 'easeIn' } },
};
export const staggerVariants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.045, delayChildren: 0.025 } },
};
export const staggerItemVariants = {
  hidden: { opacity: 0, y: 8 },
  show: { opacity: 1, y: 0, transition: { duration: 0.24, ease: [0.22, 1, 0.36, 1] } },
};
export const interactiveSpring = { type: 'spring', stiffness: 480, damping: 32, mass: 0.55 };

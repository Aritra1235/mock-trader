export const EpochConverter = (time: number): number => {
  const ninetyEightyConstant = 315532800;
  return time + ninetyEightyConstant;
};

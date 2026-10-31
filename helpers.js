export const rk4 = (f, y, h) => {
  const add = (y, k, s) => y.map((v, i) => v + s * k[i]);
  const k1 = f(y);
  const k2 = f(add(y, k1, h / 2));
  const k3 = f(add(y, k2, h / 2));
  const k4 = f(add(y, k3, h));
  return y.map((v, i) => v + h/6 * (k1[i] + 2*k2[i] + 2*k3[i] + k4[i]));
};

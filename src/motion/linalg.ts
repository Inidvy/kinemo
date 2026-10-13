// Small dense linear algebra for the motion solver. Mechanisms have a handful
// of bodies, so plain Gaussian elimination is plenty.

/** Solve A x = b in place with partial pivoting. Returns null if A is singular. */
export function solveLinear(A: number[][], b: number[]): number[] | null {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(M[r][col]) > Math.abs(M[piv][col])) piv = r;
    if (Math.abs(M[piv][col]) < 1e-14) return null;
    [M[col], M[piv]] = [M[piv], M[col]];
    for (let r = col + 1; r < n; r++) {
      const f = M[r][col] / M[col][col];
      if (f === 0) continue;
      for (let k = col; k <= n; k++) M[r][k] -= f * M[col][k];
    }
  }
  const x = new Array<number>(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    let s = M[r][n];
    for (let k = r + 1; k < n; k++) s -= M[r][k] * x[k];
    x[r] = s / M[r][r];
  }
  return x;
}

/** Numerical rank of a matrix (rows × cols). */
export function rank(A: number[][], tol = 1e-8): number {
  const M = A.map((r) => [...r]);
  const rows = M.length;
  const cols = rows ? M[0].length : 0;
  let rk = 0;
  for (let col = 0; col < cols && rk < rows; col++) {
    let piv = rk;
    for (let r = rk + 1; r < rows; r++) if (Math.abs(M[r][col]) > Math.abs(M[piv][col])) piv = r;
    if (Math.abs(M[piv][col]) < tol) continue;
    [M[rk], M[piv]] = [M[piv], M[rk]];
    for (let r = rk + 1; r < rows; r++) {
      const f = M[r][col] / M[rk][col];
      for (let k = col; k < cols; k++) M[r][k] -= f * M[rk][k];
    }
    rk++;
  }
  return rk;
}

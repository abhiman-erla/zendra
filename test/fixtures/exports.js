export function alpha() {
  return "alpha";
}

export default function beta() {
  return "beta";
}

export const gamma = () => "gamma";

function plain() {
  return "plain";
}

function outer() {
  function nestedHelper() {
    return "nested";
  }
  return nestedHelper();
}

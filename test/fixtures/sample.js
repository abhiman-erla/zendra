function add(a, b) {
  return a + b;
}

function subtract(a, b) {
  return a - b;
}

const multiply = (a, b) => {
  return a * b;
};

class Calculator {
  constructor(initial) {
    this.value = initial;
  }

  add(n) {
    this.value += n;
    return this.value;
  }

  subtract(n) {
    this.value -= n;
    return this.value;
  }
}

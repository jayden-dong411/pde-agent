import { PdeError } from "./errors.ts";

type Expr =
  | { type: "num"; value: number }
  | { type: "var"; name: "x" | "y" | "t" }
  | { type: "unary"; op: "-"; arg: Expr }
  | { type: "binary"; op: "+" | "-" | "*" | "/" | "^"; left: Expr; right: Expr }
  | { type: "call"; name: string; args: Expr[] };

type Token =
  | { type: "num"; value: number }
  | { type: "id"; value: string }
  | { type: "op"; value: "+" | "-" | "*" | "/" | "^" }
  | { type: "lparen" }
  | { type: "rparen" }
  | { type: "comma" }
  | { type: "eof" };

const FUNCTIONS: Record<string, { arity: number; call: (...args: number[]) => number }> = {
  sin: { arity: 1, call: Math.sin },
  cos: { arity: 1, call: Math.cos },
  tan: { arity: 1, call: Math.tan },
  exp: { arity: 1, call: Math.exp },
  log: { arity: 1, call: Math.log },
  ln: { arity: 1, call: Math.log },
  sqrt: { arity: 1, call: Math.sqrt },
  abs: { arity: 1, call: Math.abs },
  min: { arity: 2, call: Math.min },
  max: { arity: 2, call: Math.max },
  pow: { arity: 2, call: Math.pow },
};

const CONSTANTS: Record<string, number> = {
  pi: Math.PI,
  e: Math.E,
};

export type ScalarField = (x: number, y: number, t: number) => number;

export function compileExpression(source: string): ScalarField {
  const expression = source.trim();
  if (!expression) {
    throw new PdeError("表达式不能为空。");
  }
  const ast = new Parser(tokenize(expression), expression).parse();
  return (x, y, t) => evaluate(ast, x, y, t);
}

function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let index = 0;
  while (index < source.length) {
    const character = source[index];
    if (character === " " || character === "\t" || character === "\n" || character === "\r") {
      index += 1;
      continue;
    }
    if (character === "(") {
      tokens.push({ type: "lparen" });
      index += 1;
      continue;
    }
    if (character === ")") {
      tokens.push({ type: "rparen" });
      index += 1;
      continue;
    }
    if (character === ",") {
      tokens.push({ type: "comma" });
      index += 1;
      continue;
    }
    if (character === "+" || character === "-" || character === "*" || character === "/" || character === "^") {
      tokens.push({ type: "op", value: character });
      index += 1;
      continue;
    }
    if ((character >= "0" && character <= "9") || character === ".") {
      const start = index;
      let cursor = index;
      let seenDot = character === ".";
      cursor += 1;
      while (cursor < source.length && source[cursor] >= "0" && source[cursor] <= "9") cursor += 1;
      if (!seenDot && source[cursor] === ".") {
        seenDot = true;
        cursor += 1;
        while (cursor < source.length && source[cursor] >= "0" && source[cursor] <= "9") cursor += 1;
      }
      if (source[cursor] === "e" || source[cursor] === "E") {
        const exponent = cursor;
        cursor += 1;
        if (source[cursor] === "+" || source[cursor] === "-") cursor += 1;
        const digits = cursor;
        while (cursor < source.length && source[cursor] >= "0" && source[cursor] <= "9") cursor += 1;
        if (cursor === digits) {
          throw new PdeError(`表达式 “${source}” 在第 ${exponent + 1} 个字符处的科学计数法不完整。`);
        }
      }
      const raw = source.slice(start, cursor);
      if (raw === ".") {
        throw new PdeError(`表达式 “${source}” 在第 ${start + 1} 个字符处不是合法数字。`);
      }
      const value = Number(raw);
      if (!Number.isFinite(value)) {
        throw new PdeError(`表达式数字 ${raw} 无法解析。`);
      }
      tokens.push({ type: "num", value });
      index = cursor;
      continue;
    }
    if ((character >= "A" && character <= "Z") || (character >= "a" && character <= "z") || character === "_") {
      const start = index;
      index += 1;
      while (index < source.length) {
        const next = source[index];
        const alphanumeric =
          (next >= "A" && next <= "Z") ||
          (next >= "a" && next <= "z") ||
          (next >= "0" && next <= "9") ||
          next === "_";
        if (!alphanumeric) break;
        index += 1;
      }
      tokens.push({ type: "id", value: source.slice(start, index) });
      continue;
    }
    throw new PdeError(`表达式 “${source}” 在第 ${index + 1} 个字符处有无法识别的字符 “${character}”。`);
  }
  tokens.push({ type: "eof" });
  return tokens;
}

class Parser {
  private pos = 0;
  private readonly tokens: Token[];
  private readonly source: string;

  constructor(tokens: Token[], source: string) {
    this.tokens = tokens;
    this.source = source;
  }

  parse(): Expr {
    const expression = this.parseExpr();
    if (this.peek().type !== "eof") {
      throw new PdeError(`表达式 “${this.source}” 在解析结束后还有多余内容。`);
    }
    return expression;
  }

  private parseExpr(): Expr {
    let node = this.parseTerm();
    for (;;) {
      const token = this.peek();
      if (token.type === "op" && (token.value === "+" || token.value === "-")) {
        this.pos += 1;
        node = { type: "binary", op: token.value, left: node, right: this.parseTerm() };
      } else {
        return node;
      }
    }
  }

  private parseTerm(): Expr {
    let node = this.parseUnary();
    for (;;) {
      const token = this.peek();
      if (token.type === "op" && (token.value === "*" || token.value === "/")) {
        this.pos += 1;
        node = { type: "binary", op: token.value, left: node, right: this.parseUnary() };
      } else {
        return node;
      }
    }
  }

  private parseUnary(): Expr {
    const token = this.peek();
    if (token.type === "op" && token.value === "-") {
      this.pos += 1;
      return { type: "unary", op: "-", arg: this.parseUnary() };
    }
    if (token.type === "op" && token.value === "+") {
      this.pos += 1;
      return this.parseUnary();
    }
    return this.parsePower();
  }

  private parsePower(): Expr {
    const base = this.parsePrimary();
    const token = this.peek();
    if (token.type === "op" && token.value === "^") {
      this.pos += 1;
      return { type: "binary", op: "^", left: base, right: this.parseUnary() };
    }
    return base;
  }

  private parsePrimary(): Expr {
    const token = this.peek();
    if (token.type === "num") {
      this.pos += 1;
      return { type: "num", value: token.value };
    }
    if (token.type === "id") {
      this.pos += 1;
      const name = token.value.toLowerCase();
      if (this.peek().type === "lparen") {
        const args = this.parseArguments();
        const fn = FUNCTIONS[name];
        if (!fn) {
          throw new PdeError(`表达式 “${this.source}” 使用了未知函数 ${token.value}。`);
        }
        if (args.length !== fn.arity) {
          throw new PdeError(`函数 ${token.value} 需要 ${fn.arity} 个参数。`);
        }
        return { type: "call", name, args };
      }
      if (name === "x" || name === "y" || name === "t") {
        return { type: "var", name };
      }
      const constant = CONSTANTS[name];
      if (constant !== undefined) {
        return { type: "num", value: constant };
      }
      throw new PdeError(`表达式 “${this.source}” 使用了未知名称 ${token.value}。可用变量是 x、y、t。`);
    }
    if (token.type === "lparen") {
      this.pos += 1;
      const expression = this.parseExpr();
      this.expect("rparen");
      return expression;
    }
    throw new PdeError(`表达式 “${this.source}” 在第 ${this.pos + 1} 个记号处不完整。`);
  }

  private parseArguments(): Expr[] {
    this.expect("lparen");
    const args: Expr[] = [];
    if (this.peek().type !== "rparen") {
      args.push(this.parseExpr());
      while (this.peek().type === "comma") {
        this.pos += 1;
        args.push(this.parseExpr());
      }
    }
    this.expect("rparen");
    return args;
  }

  private expect(type: Token["type"]): void {
    const token = this.peek();
    if (token.type !== type) {
      throw new PdeError(`表达式 “${this.source}” 缺少 ${type === "rparen" ? "右括号" : "语法成分"}。`);
    }
    this.pos += 1;
  }

  private peek(): Token {
    return this.tokens[this.pos] ?? { type: "eof" };
  }
}

function evaluate(node: Expr, x: number, y: number, t: number): number {
  switch (node.type) {
    case "num":
      return node.value;
    case "var":
      if (node.name === "x") return x;
      if (node.name === "y") return y;
      return t;
    case "unary":
      return -evaluate(node.arg, x, y, t);
    case "binary": {
      const left = evaluate(node.left, x, y, t);
      const right = evaluate(node.right, x, y, t);
      if (node.op === "+") return left + right;
      if (node.op === "-") return left - right;
      if (node.op === "*") return left * right;
      if (node.op === "/") return left / right;
      return left ** right;
    }
    case "call": {
      const fn = FUNCTIONS[node.name];
      if (!fn) {
        throw new PdeError(`表达式使用了未知函数 ${node.name}。`);
      }
      if (node.args.length !== fn.arity) {
        throw new PdeError(`函数 ${node.name} 需要 ${fn.arity} 个参数。`);
      }
      return fn.call(...node.args.map((arg) => evaluate(arg, x, y, t)));
    }
  }
}

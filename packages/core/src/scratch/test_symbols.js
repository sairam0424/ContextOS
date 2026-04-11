
const fs = require('fs');
const content = `
export function MyFunction(param: string) {
    return true;
}

export class MyClass {
    constructor() {}
}

export const MyVar = (a, b) => a + b;

function internalFunc() {}
`;

const tsRegex = /export\s+(function|class|const|async\s+function)\s+([a-zA-Z0-9_]+)/g;
let match;
console.log("TS Matches:");
while ((match = tsRegex.exec(content)) !== null) {
    console.log(`- Type: ${match[1]}, Name: ${match[2]}`);
}

const pyContent = `
def my_python_func(a):
    pass

class MyPythonClass:
    def __init__(self):
        pass
`;

const pyRegex = /^(def|class)\s+([a-zA-Z0-9_]+)/gm;
console.log("\nPython Matches:");
while ((match = pyRegex.exec(pyContent)) !== null) {
    console.log(`- Type: ${match[1]}, Name: ${match[2]}`);
}

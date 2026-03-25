interface TestResult {
  name: string;
  passed: boolean;
  error?: string;
  duration: number;
}

interface SuiteResult {
  name: string;
  tests: { name: string; fn: () => Promise<void> }[];
  results: TestResult[];
}

const suites: SuiteResult[] = [];
let currentSuite: SuiteResult | null = null;

export function describe(name: string, fn: () => void): void {
  currentSuite = { name, tests: [], results: [] };
  suites.push(currentSuite);
  fn();
  currentSuite = null;
}

export function test(name: string, fn: () => Promise<void>): void {
  if (!currentSuite) {
    throw new Error('test() must be called inside describe()');
  }
  currentSuite.tests.push({ name, fn });
}

export function expect<T>(actual: T) {
  return {
    toBe(expected: T): void {
      if (actual !== expected) {
        throw new Error(`Expected ${expected} but got ${actual}`);
      }
    },
    toEqual(expected: T): void {
      if (JSON.stringify(actual) !== JSON.stringify(expected)) {
        throw new Error(`Expected ${JSON.stringify(expected)} but got ${JSON.stringify(actual)}`);
      }
    },
    toBeTruthy(): void {
      if (!actual) {
        throw new Error(`Expected truthy value but got ${actual}`);
      }
    },
    toBeFalsy(): void {
      if (actual) {
        throw new Error(`Expected falsy value but got ${actual}`);
      }
    },
    toContain(expected: string): void {
      if (typeof actual !== 'string' || !actual.includes(expected)) {
        throw new Error(`Expected "${actual}" to contain "${expected}"`);
      }
    },
    toBeGreaterThan(expected: number): void {
      if (typeof actual !== 'number' || actual <= expected) {
        throw new Error(`Expected ${actual} to be greater than ${expected}`);
      }
    }
  };
}

export function beforeAll(fn: () => Promise<void>): void {
  fn();
}

export async function runTests(): Promise<void> {
  console.log('\n========================================');
  console.log('         TEST RESULTS');
  console.log('========================================\n');
  
  let totalTests = 0;
  let passedTests = 0;
  let failedTests = 0;
  
  for (const suite of suites) {
    console.log(`\n[Suite] ${suite.name}`);
    console.log('----------------------------------------');
    
    for (const testCase of suite.tests) {
      totalTests++;
      const start = Date.now();
      try {
        await testCase.fn();
        const duration = Date.now() - start;
        passedTests++;
        console.log(`  [PASS] ${testCase.name} (${duration}ms)`);
        suite.results.push({ name: testCase.name, passed: true, duration });
      } catch (error) {
        const duration = Date.now() - start;
        failedTests++;
        const errorMsg = error instanceof Error ? error.message : String(error);
        console.log(`  [FAIL] ${testCase.name} (${duration}ms)`);
        console.log(`         Error: ${errorMsg}`);
        suite.results.push({ name: testCase.name, passed: false, error: errorMsg, duration });
      }
    }
  }
  
  console.log('\n========================================');
  console.log(`Total: ${totalTests} | Passed: ${passedTests} | Failed: ${failedTests}`);
  console.log('========================================\n');
  
  if (failedTests > 0) {
    process.exit(1);
  }
}

import type { CategoryId, CheckOutcome, Finding, PassedCheck } from "../types";

/** Small collector so each check file stays short. */
export class Collector {
  readonly findings: Finding[] = [];
  readonly passed: PassedCheck[] = [];
  constructor(private category: CategoryId) {}

  fail(f: Omit<Finding, "category">): void {
    this.findings.push({ ...f, category: this.category });
  }

  pass(id: string, title: string): void {
    this.passed.push({ id, title, category: this.category });
  }

  /** Records a pass when ok, otherwise the given finding. */
  check(ok: boolean, passTitle: string, f: Omit<Finding, "category">): void {
    if (ok) this.pass(f.id, passTitle);
    else this.fail(f);
  }

  result(): CheckOutcome {
    return { findings: this.findings, passed: this.passed };
  }
}

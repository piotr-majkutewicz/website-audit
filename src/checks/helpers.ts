import type { FindingKey, Params, PassedId } from "../i18n/types";
import type { CategoryId, CheckOutcome, RawFinding, RawPassed, Severity } from "../types";

export interface FindingSpec {
  /** Stable id. For a check that can pass, it is also the id of the passed text. */
  id: string;
  /** Text variant. Defaults to the id when the check has a single variant. */
  key?: FindingKey;
  severity: Severity;
  params?: Params;
}

/** Small collector so each check file stays short. */
export class Collector {
  readonly findings: RawFinding[] = [];
  readonly passed: RawPassed[] = [];
  constructor(private category: CategoryId) {}

  fail(f: FindingSpec): void {
    this.findings.push({
      id: f.id,
      key: f.key ?? (f.id as FindingKey),
      category: this.category,
      severity: f.severity,
      params: f.params ?? {},
    });
  }

  pass(id: string): void {
    this.passed.push({ id: id as PassedId, category: this.category });
  }

  /** Records a pass when ok, otherwise the given finding. */
  check(ok: boolean, f: FindingSpec): void {
    if (ok) this.pass(f.id);
    else this.fail(f);
  }

  result(): CheckOutcome {
    return { findings: this.findings, passed: this.passed };
  }
}

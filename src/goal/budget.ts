export interface LifetimeBudget {
  maxTurns: number;
  maxWallTimeMs: number;
  maxEvaluatorCalls: number;
  totalTokensEstimate: number;
  extensions: number;
}

export interface BudgetState {
  turns: number;
  evaluatorCalls: number;
  startedAt: number;
  tokenGrowth: number;
  extensions: number;
}

const DEFAULT_BUDGET: LifetimeBudget = {
  maxTurns: 100,
  maxWallTimeMs: 30 * 60 * 1000, // 30 minutes
  maxEvaluatorCalls: 20,
  totalTokensEstimate: 500_000,
  extensions: 0,
};

export class AutonomyBudget {
  private state: BudgetState;

  constructor(
    private budget: LifetimeBudget = DEFAULT_BUDGET,
  ) {
    this.state = {
      turns: 0,
      evaluatorCalls: 0,
      startedAt: Date.now(),
      tokenGrowth: 0,
      extensions: 0,
    };
  }

  recordTurn(): void {
    this.state.turns += 1;
  }

  recordEvaluatorCall(): void {
    this.state.evaluatorCalls += 1;
  }

  addTokens(tokens: number): void {
    this.state.tokenGrowth += tokens;
  }

  extend(additionalTurns: number, additionalTimeMs: number): void {
    this.state.extensions += 1;
    this.budget.maxTurns += additionalTurns;
    this.budget.maxWallTimeMs += additionalTimeMs;
  }

  isExhausted(): { exhausted: boolean; reason?: string } {
    if (this.state.turns >= this.budget.maxTurns) {
      return { exhausted: true, reason: `turn limit (${this.budget.maxTurns}) reached` };
    }

    const elapsed = Date.now() - this.state.startedAt;
    if (elapsed >= this.budget.maxWallTimeMs) {
      return { exhausted: true, reason: `wall-time limit (${this.budget.maxWallTimeMs}ms) reached` };
    }

    if (this.state.evaluatorCalls >= this.budget.maxEvaluatorCalls) {
      return { exhausted: true, reason: `evaluator call limit (${this.budget.maxEvaluatorCalls}) reached` };
    }

    if (this.state.tokenGrowth >= this.budget.totalTokensEstimate) {
      return { exhausted: true, reason: `token budget (${this.budget.totalTokensEstimate}) exceeded` };
    }

    return { exhausted: false };
  }

  remaining(): { turns: number; timeMs: number; evaluatorCalls: number } {
    return {
      turns: Math.max(0, this.budget.maxTurns - this.state.turns),
      timeMs: Math.max(0, this.budget.maxWallTimeMs - (Date.now() - this.state.startedAt)),
      evaluatorCalls: Math.max(0, this.budget.maxEvaluatorCalls - this.state.evaluatorCalls),
    };
  }
}

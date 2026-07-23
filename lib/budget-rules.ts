export type IncomeMap = { me: number; partner: number };

export type SplitSummary = {
  combinedIncome: number;
  incomePercentages: IncomeMap;
  housingShares: IncomeMap;
  otherShares: IncomeMap;
  combinedShared: number;
  zeroIncome: boolean;
};

const money = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

export function calculateSharedSplits(
  incomes: IncomeMap,
  housingTotal: number,
  otherTotal: number,
): SplitSummary {
  const combinedIncome = money(incomes.me + incomes.partner);
  const zeroIncome = combinedIncome <= 0;
  const incomePercentages = zeroIncome
    ? { me: 0, partner: 0 }
    : {
        me: incomes.me / combinedIncome,
        partner: incomes.partner / combinedIncome,
      };

  return {
    combinedIncome,
    incomePercentages,
    housingShares: {
      me: money(housingTotal * 0.75),
      partner: money(housingTotal * 0.25),
    },
    otherShares: zeroIncome
      ? { me: 0, partner: 0 }
      : {
          me: money(otherTotal * incomePercentages.me),
          partner: money(otherTotal * incomePercentages.partner),
        },
    combinedShared: money(housingTotal + otherTotal),
    zeroIncome,
  };
}

export function scopeLabel(scope: string, planNames?: Record<"me" | "partner", string>) {
  return (
    {
      me: planNames?.me ?? "My budget",
      partner: planNames?.partner ?? "Partner budget",
      shared_housing: "Shared housing",
      shared_other: "Shared household",
    }[scope] ?? scope
  );
}

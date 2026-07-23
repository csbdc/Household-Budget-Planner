import type { Metadata } from "next";
import BudgetApp from "./BudgetApp";

export const metadata: Metadata = {
  title: "Household Budget Planner",
  description: "A calmer way for two people to plan personal and shared money.",
};

export default function Home() {
  return <BudgetApp />;
}

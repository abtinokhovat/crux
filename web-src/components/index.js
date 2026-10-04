import { adrCards, compare, decision, options, proscons, scenarios, stats, tradeoff } from "./decision.js";
import { tree } from "./tree.js";
import { arch, rules } from "./cards.js";
import { sequence } from "./sequence.js";
import { playline } from "./playline.js";
import { sim } from "./sim.js";

export const BUILTIN = [decision, options, compare, scenarios, proscons, tradeoff, stats, adrCards, tree, rules, arch, sequence, playline, sim];

/**
 * ComboFilter — AG Grid Community-д зориулсан Excel-маягийн custom filter.
 * Нэг filter дотор: оператор (contains / starts / ends / wildcard / =, ≠, >, <, between)
 * + checkbox утгын жагсаалт (хайлт + "Бүгд"). Хоёулаа зэрэг (AND) ажиллана.
 *
 * AG Grid-ийн IFilterComp интерфейсийг хэрэгжүүлдэг framework-agnostic класс тул
 * React/Vue/vanilla бүгдэд адил ажиллана. Зүгээр л  filter: ComboFilter  гэж онооно.
 */
import type {
  IDoesFilterPassParams,
  IFilterComp,
  IFilterParams,
} from "ag-grid-community";

type Op =
  | "contains" | "ncontains" | "starts" | "ends" | "wild"
  | "eq" | "ne" | "gt" | "lt" | "between";

const OPS: { v: Op; t: string }[] = [
  { v: "contains",  t: "Агуулсан (contains)" },
  { v: "ncontains", t: "Агуулаагүй (not contains)" },
  { v: "starts",    t: "Эхэлсэн (starts with)" },
  { v: "ends",      t: "Төгссөн (ends with)" },
  { v: "wild",      t: "Хэв маяг (* ?)" },
  { v: "eq",        t: "Тэнцүү (=)" },
  { v: "ne",        t: "Тэнцүү биш (≠)" },
  { v: "gt",        t: "Их (>)" },
  { v: "lt",        t: "Бага (<)" },
  { v: "between",   t: "Хооронд (between)" },
];

const asNum = (x: unknown): number | null => {
  const n = parseFloat(String(x));
  return isNaN(n) ? null : n;
};
const wildToRegex = (pat: string): RegExp => {
  const esc = String(pat).replace(/[.+^${}()|[\]\\]/g, "\\$&"); // *, ? -ээс бусдыг escape
  return new RegExp("^" + esc.replace(/\*/g, ".*").replace(/\?/g, ".") + "$", "i");
};
function cmp(cell: unknown, op: Op | "", a: string, b: string): boolean {
  if (!op || a === "" || a == null) return true;
  const cn = asNum(cell), an = asNum(a);
  const numeric = cn !== null && an !== null;
  const cs = String(cell).toLowerCase(), as = String(a).toLowerCase();
  switch (op) {
    case "contains":  return cs.includes(as);
    case "ncontains": return !cs.includes(as);
    case "starts":    return cs.startsWith(as);
    case "ends":      return cs.endsWith(as);
    case "wild":      return wildToRegex(a).test(String(cell));
    case "eq":  return numeric ? cn === an : cs === as;
    case "ne":  return numeric ? cn !== an : cs !== as;
    case "gt":  return numeric ? (cn as number) > (an as number) : cs > as;
    case "lt":  return numeric ? (cn as number) < (an as number) : cs < as;
    case "between": {
      const bn = asNum(b);
      if (numeric && bn !== null)
        return (cn as number) >= Math.min(an as number, bn) && (cn as number) <= Math.max(an as number, bn);
      const bs = String(b).toLowerCase();
      return cs >= as && cs <= bs;
    }
  }
  return true;
}

interface Model { op: Op; v1: string; v2: string; values: unknown[] | null; }

type Row = Record<string, unknown>;

export class ComboFilter implements IFilterComp {
  private params!: IFilterParams;
  private field!: string;
  private kind: "date" | "num" | "text" = "text";
  private op: Op = "contains";
  private v1 = "";
  private v2 = "";
  private selected: Set<unknown> | null = null; // null = бүх утга идэвхтэй
  private values: unknown[] = [];

  private gui!: HTMLDivElement;
  private opEl!: HTMLSelectElement;
  private v1El!: HTMLInputElement;
  private v2wrap!: HTMLDivElement;
  private v2El!: HTMLInputElement;
  private hintEl!: HTMLDivElement;
  private infoEl!: HTMLSpanElement;
  private searchEl!: HTMLInputElement;
  private allEl!: HTMLInputElement;
  private listEl!: HTMLDivElement;

  init(params: IFilterParams): void {
    this.params = params;
    this.field = params.colDef.field ?? "";
    this.values = this.collectValues();

    const sample = this.values.find((v) => v != null);
    if (/^\d{4}-\d{2}-\d{2}/.test(String(sample))) this.kind = "date";
    else if (asNum(sample) !== null) this.kind = "num";
    else this.kind = "text";

    this.gui = document.createElement("div");
    this.gui.className = "cf";
    this.gui.innerHTML = `
      <div class="cap">Оператор <span class="info" title="Тайлбар">i</span></div>
      <select class="op">${OPS.map((o) => `<option value="${o.v}">${o.t}</option>`).join("")}</select>
      <input class="v1" placeholder="утга"/>
      <div class="row2" style="display:none"><input class="v2" placeholder="хүртэл"/></div>
      <div class="hint" style="display:none"></div>
      <div class="sep"></div>
      <div class="cap">Утгууд</div>
      <input class="search" placeholder="Хайх..."/>
      <label class="all"><input type="checkbox" class="allcb" checked/><span>Бүгд</span></label>
      <div class="list"></div>`;

    this.opEl = this.gui.querySelector(".op")!;
    this.v1El = this.gui.querySelector(".v1")!;
    this.v2wrap = this.gui.querySelector(".row2")!;
    this.v2El = this.gui.querySelector(".v2")!;
    this.hintEl = this.gui.querySelector(".hint")!;
    this.infoEl = this.gui.querySelector(".info")!;
    this.searchEl = this.gui.querySelector(".search")!;
    this.allEl = this.gui.querySelector(".allcb")!;
    this.listEl = this.gui.querySelector(".list")!;

    this.opEl.value = "contains";
    this.updateHint();
    this.infoEl.addEventListener("click", () => {
      this.hintEl.style.display = this.hintEl.style.display === "none" ? "block" : "none";
    });

    const changed = () => {
      this.op = this.opEl.value as Op;
      this.v1 = this.v1El.value;
      this.v2 = this.v2El.value;
      this.v2wrap.style.display = this.op === "between" ? "flex" : "none";
      this.updateHint();
      this.params.filterChangedCallback();
    };
    this.opEl.addEventListener("change", changed);
    this.v1El.addEventListener("input", changed);
    this.v2El.addEventListener("input", changed);
    this.searchEl.addEventListener("input", () => this.render());
    this.allEl.addEventListener("change", () => {
      this.selected = this.allEl.checked ? null : new Set();
      this.render();
      this.params.filterChangedCallback();
    });
    this.render();
  }

  private collectValues(): unknown[] {
    const s = new Set<unknown>();
    this.params.api.forEachNode((n) => {
      const d = n.data as Row | undefined;
      if (d) s.add(d[this.field]);
    });
    return Array.from(s).sort((a, b) => {
      const an = asNum(a), bn = asNum(b);
      return an !== null && bn !== null ? an - bn : String(a).localeCompare(String(b));
    });
  }

  private updateHint(): void {
    const common =
      "<br>• <b>* ?</b> хэв маяг: <b>*</b>=олон тэмдэгт, <b>?</b>=нэг тэмдэгт. Жишээ: <b>loiter*</b>, <b>*conceal</b>" +
      "<br>• «Эхэлсэн / Төгссөн» = тухайн текстээр эхэлсэн/төгссөн";
    const ex =
      this.kind === "date"
        ? "Огноо: <b>2026-06-10</b> эсвэл <b>2026-06-10 14:30</b>. Хэсэгчилж шүүхэд «Агуулсан»."
        : this.kind === "num"
        ? "Тоо: жишээ <b>0.5</b> &nbsp;(«Хооронд» = 2 утга)"
        : "Текст: жишээ <b>утга</b>";
    this.hintEl.innerHTML = ex + common;
    this.v1El.placeholder = this.kind === "date" ? "2026-06-10" : this.kind === "num" ? "0.5" : "утга";
    this.v2El.placeholder = this.kind === "date" ? "2026-06-15" : "хүртэл";
  }

  private render(): void {
    const q = this.searchEl.value.toLowerCase();
    const shown = this.values.filter((v) => String(v).toLowerCase().includes(q));
    this.listEl.innerHTML = "";
    shown.forEach((v) => {
      const checked = this.selected === null || this.selected.has(v);
      const lab = document.createElement("label");
      lab.innerHTML = `<input type="checkbox" ${checked ? "checked" : ""}/><span>${v}</span>`;
      lab.querySelector("input")!.addEventListener("change", (e) => {
        if (this.selected === null) this.selected = new Set(this.values);
        if ((e.target as HTMLInputElement).checked) this.selected.add(v);
        else this.selected.delete(v);
        if (this.selected.size === this.values.length) this.selected = null;
        this.allEl.checked = this.selected === null;
        this.params.filterChangedCallback();
      });
      this.listEl.appendChild(lab);
    });
  }

  isFilterActive(): boolean {
    // op нь үргэлж тодорхой (default "contains") тул зөвхөн v1 / checkbox-оор шийднэ.
    return this.selected !== null || this.v1 !== "";
  }
  doesFilterPass(p: IDoesFilterPassParams): boolean {
    const val = (p.data as Row)[this.field];
    const opPass = cmp(val, this.op, this.v1, this.v2);
    const cbPass = this.selected === null || this.selected.has(val);
    return opPass && cbPass;
  }
  getModel(): Model | null {
    if (!this.isFilterActive()) return null;
    return { op: this.op, v1: this.v1, v2: this.v2, values: this.selected ? [...this.selected] : null };
  }
  setModel(m: Model | null): void {
    if (!m) { this.op = "contains"; this.v1 = ""; this.v2 = ""; this.selected = null; return; }
    this.op = m.op || "contains";
    this.v1 = m.v1 || "";
    this.v2 = m.v2 || "";
    this.selected = m.values ? new Set(m.values) : null;
  }
  getGui(): HTMLElement { return this.gui; }
}

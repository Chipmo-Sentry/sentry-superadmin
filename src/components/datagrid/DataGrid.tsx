/**
 * DataGrid — дахин ашиглах боломжтой хүснэгт компонент.
 * Verno / Sentry зэрэг аль ч төсөлд:  <DataGrid rowData={...} columnDefs={...} />
 *
 * Дотроо:
 *  - бүх баганад ижил ComboFilter (оператор + checkbox)
 *  - Shift/Ctrl-ээр мөр сонголт (default; gridOptions-оор дарж бичиж болно)
 *  - hover дээр мөр/баганын өнгө
 *  - текст сонголт идэвхгүй (зөвхөн мөр сонгоно)
 *  - pagination
 */
import {
  AllCommunityModule,
  ModuleRegistry,
  type ColDef,
  type GridOptions,
} from "ag-grid-community";
import { AgGridReact } from "ag-grid-react";

import { ComboFilter } from "./ComboFilter";
import "./datagrid.css";

// AG Grid v33 module бүртгэл (нэг л удаа)
ModuleRegistry.registerModules([AllCommunityModule]);

export interface DataGridProps<T = Record<string, unknown>> {
  rowData: T[];
  columnDefs: ColDef<T>[];
  /** нэг хуудсан дахь мөрийн тоо (default 25) */
  pageSize?: number;
  /** мөрийн өндөр (default 32) */
  rowHeight?: number;
  /** нэмэлт AG Grid тохиргоо дарж бичих бол */
  gridOptions?: Partial<GridOptions<T>>;
  /** контейнерийн өндөр (default 540px) */
  height?: number | string;
}

export function DataGrid<T = Record<string, unknown>>({
  rowData,
  columnDefs,
  pageSize = 25,
  rowHeight = 32,
  gridOptions = {},
  height = 540,
}: DataGridProps<T>) {
  const defaultColDef: ColDef = {
    sortable: true,
    resizable: true,
    filter: ComboFilter, // ← бүх баганад ижил filter
    flex: 1,
    minWidth: 90,
  };

  return (
    <div
      className="ag-theme-quartz-dark cw-grid"
      style={{ height, width: "100%" }}
    >
      <AgGridReact<T>
        theme="legacy"             /* CSS theme (ag-theme-quartz-dark) ашиглана */
        rowData={rowData}
        columnDefs={columnDefs}
        defaultColDef={defaultColDef}
        rowSelection={{
          mode: "multiRow",
          checkboxes: true,
          headerCheckbox: true,
          enableClickSelection: true, // Shift/Ctrl-ээр мөр сонгох
        }}
        rowHeight={rowHeight}
        headerHeight={36}
        columnHoverHighlight={true}
        pagination={true}
        paginationPageSize={pageSize}
        {...gridOptions}
      />
    </div>
  );
}

export default DataGrid;

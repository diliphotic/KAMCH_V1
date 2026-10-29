import React from 'react';

export interface Column<T> {
  key: string;
  header: string;
  render?: (row: T) => React.ReactNode;
  align?: 'left' | 'center' | 'right';
  className?: string;
  isNumeric?: boolean;
}

export interface TableProps<T> {
  columns: Column<T>[];
  data: T[];
  keyExtractor: (row: T, index: number) => string | number;
  emptyMessage?: string;
  caption?: string;
  dense?: boolean;
  className?: string;
}

export function Table<T>({
  columns,
  data,
  keyExtractor,
  emptyMessage = 'No records found in this view.',
  caption,
  dense = false,
  className = '',
}: TableProps<T>) {
  const cellPadding = dense ? 'px-3 py-2 text-xs' : 'px-4 py-3 text-sm';
  const headerPadding = dense ? 'px-3 py-2 text-xs' : 'px-4 py-2.5 text-xs';

  return (
    <div className={`w-full overflow-x-auto rounded-lg border border-stone-200 bg-white ${className}`}>
      <table className="w-full text-left border-collapse">
        {caption && (
          <caption className="sr-only">{caption}</caption>
        )}
        <thead className="bg-[#FAF9F5] border-b border-stone-200 text-stone-700 font-semibold uppercase tracking-wider text-[11px]">
          <tr>
            {columns.map((col) => {
              const alignClass =
                col.align === 'right' || col.isNumeric
                  ? 'text-right'
                  : col.align === 'center'
                  ? 'text-center'
                  : 'text-left';
              return (
                <th
                  key={col.key}
                  scope="col"
                  className={`${headerPadding} ${alignClass} ${col.className || ''}`}
                >
                  {col.header}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody className="divide-y divide-stone-100 text-stone-800">
          {data.length === 0 ? (
            <tr>
              <td
                colSpan={columns.length}
                className="px-4 py-8 text-center text-xs text-stone-500 italic"
              >
                {emptyMessage}
              </td>
            </tr>
          ) : (
            data.map((row, index) => (
              <tr
                key={keyExtractor(row, index)}
                className="hover:bg-stone-50/70 transition-colors"
              >
                {columns.map((col) => {
                  const alignClass =
                    col.align === 'right' || col.isNumeric
                      ? 'text-right'
                      : col.align === 'center'
                      ? 'text-center'
                      : 'text-left';
                  const numericClass = col.isNumeric ? 'tabular-nums font-mono' : '';
                  return (
                    <td
                      key={col.key}
                      className={`${cellPadding} ${alignClass} ${numericClass} ${col.className || ''}`}
                    >
                      {col.render ? col.render(row) : (row as Record<string, unknown>)[col.key] as React.ReactNode}
                    </td>
                  );
                })}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

import { ColumnType } from '../generator/types';
const $eq = Symbol('$eq');
const $neq = Symbol('$neq');
const $in = Symbol('$in');

import * as PgSql2 from 'pg-sql2';
import { IDatabase } from 'pg-promise';

export const Op = {
  $eq: $eq,
  $neq: $neq,
  $in: $in,
} as const;
type Operators = typeof Op[keyof typeof Op];

type OperandTypeForOperator<O extends Operators, T> = {
  [$eq]: T;
  [$neq]: T;
  [$in]: T[];
}[O];

export type Table = {
  name: string;
  columns: Record<string, ColumnMetaData<Table>>;
};

type Pretty<T> = { [K in keyof T]: T[K] };

/**
 * @description Convert SQL column string literal type to JavaScript type
 */
type SupportedTypes = {
  bit: 'Not supported yet!';
  bool: boolean;
  box: 'Not supported yet!';
  bytea: 'Not supported yet!';
  char: string;
  cidr: 'Not supported yet!';
  circle: 'Not supported yet!';
  date: Date;
  float4: number;
  float8: number;
  inet: 'Not supported yet!';
  int2: number;
  int4: number;
  int8: number;
  interval: 'Not supported yet!';
  json: 'Not supported yet!';
  jsonb: 'Not supported yet!';
  line: 'Not supported yet!';
  lseg: 'Not supported yet!';
  macaddr: 'Not supported yet!';
  macaddr8: 'Not supported yet!';
  money: 'Not supported yet!';
  numeric: number;
  path: 'Not supported yet!';
  pg_lsn: 'Not supported yet!';
  point: 'Not supported yet!';
  polygon: 'Not supported yet!';
  text: string;
  time: 'Not supported yet!';
  timestamp: number;
  timestamptz: number;
  timetz: 'Not supported yet!';
  tsquery: 'Not supported yet!';
  tsvector: 'Not supported yet!';
  txid_snapshot: 'Not supported yet!';
  uuid: 'Not supported yet!';
  varbit: 'Not supported yet!';
  varchar: string;
  xml: 'Not supported yet!';
};

type GetJSTypeFromSqlType<
  T extends ColumnType,
  Nullable extends boolean
> = T extends keyof SupportedTypes
  ? SupportedTypes[T] | (Nullable extends false ? null : never)
  : never;

type GetColumnJSType<
  SelectedTable extends Table,
  SelectedColumn extends keyof SelectedTable['columns']
> = Pretty<
  GetJSTypeFromSqlType<
    SelectedTable['columns'][SelectedColumn]['type'],
    SelectedTable['columns'][SelectedColumn]['notNull']
  >
>;

/**
 * @description information about column such as if it's nullable, foreign key, autoincrement etc.
 */
type ColumnMetaData<_M extends Table, Type extends ColumnType = ColumnType> = {
  type: Type;
  notNull: boolean;
  // … @todo
};

function conditionToSql<SelectedTable extends Table>([
  column,
  operator,
  value,
]: [
  keyof SelectedTable['columns'],
  Operators,
  OperandTypeForOperator<
    Operators,
    GetColumnJSType<SelectedTable, keyof SelectedTable['columns']>
  >,
]) {
  switch (operator) {
    case Op.$eq:
      return PgSql2.query`${PgSql2.identifier(
        column as string,
      )} = ${PgSql2.value(value)}`;
    case Op.$neq:
      return PgSql2.query`${PgSql2.identifier(
        column as string,
      )} <> ${PgSql2.value(value)}`;
    case Op.$in:
      return PgSql2.query`${PgSql2.identifier(
        column as string,
      )} in (${PgSql2.join(
        (value as Array<any>).map((v) => PgSql2.value(v)),
        ',',
      )})`;
  }
}

class Query<
  SelectedTable extends Table,
  ExistingColumns extends keyof SelectedTable['columns'] = never
> {
  private table!: SelectedTable;
  private columns: Array<keyof SelectedTable['columns']> | '*' = [];
  private conditions: Array<
    [
      keyof SelectedTable['columns'],
      Operators,
      OperandTypeForOperator<
        Operators,
        GetColumnJSType<SelectedTable, keyof SelectedTable['columns']>
      >,
    ]
  > = [];

  select<NewColumns extends Array<keyof SelectedTable['columns']> | '*'>(
    columns: NewColumns,
  ): Query<
    SelectedTable,
    | ExistingColumns
    | (NewColumns extends '*'
        ? keyof SelectedTable['columns']
        : NewColumns[number])
  > {
    if (this.columns === '*') {
    } else if (columns === '*') {
      this.columns = '*';
    } else {
      this.columns.push(...columns);
    }
    return this as Query<
      SelectedTable,
      | ExistingColumns
      | (NewColumns extends '*'
          ? keyof SelectedTable['columns']
          : NewColumns[number])
    >;
  }

  where<
    ConditionColumn extends keyof SelectedTable['columns'],
    Operator extends Operators
  >(
    condition: [
      ConditionColumn,
      Operator,
      OperandTypeForOperator<
        Operator,
        GetColumnJSType<SelectedTable, ConditionColumn>
      >,
    ],
  ): Query<SelectedTable, ExistingColumns> {
    this.conditions.push(condition);
    return this;
  }

  // then(
  //   onfulfilled?: (
  //     value: Array<
  //       {
  //         [Col in ExistingColumns]: GetColumnJSType<SelectedTable, Col>;
  //       }
  //     >,
  //   ) => any,
  //   onrejected?: (reason: any) => any,
  // ): any;

  getQuery() {
    const from = PgSql2.identifier(this.table.name);
    const fields = Array.isArray(this.columns)
      ? PgSql2.join(
          this.columns.map((fieldName) =>
            PgSql2.identifier(this.table.name, fieldName as string),
          ),
          ', ',
        )
      : PgSql2.raw('*');

    const conditions =
      this.conditions.length > 0
        ? PgSql2.query`WHERE ${PgSql2.join(
            this.conditions.map((c) => conditionToSql(c)),
            ') AND (',
          )}`
        : PgSql2.query``;

    const query = PgSql2.query`SELECT ${fields} FROM ${from} ${conditions}`;
    return PgSql2.compile(query);
  }

  execute(
    pgConnection: IDatabase<{}>,
  ): Promise<
    Array<
      {
        [Col in ExistingColumns]: GetColumnJSType<SelectedTable, Col>;
      }
    >
  > {
    const { text, values } = this.getQuery();

    return pgConnection.manyOrNone(text, values);
  }

  constructor(table: SelectedTable) {
    this.table = table;
  }
}

export const Gostek = {
  from<T extends Table>(table: T): Query<T> {
    return new Query(table);
  },
};

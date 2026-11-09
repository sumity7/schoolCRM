import { defineTenantModel } from '../tenancy/registry';

export interface ICounter {
  key: string;
  seq: number;
}

/** Per-school atomic sequences (receipt numbers, invoice numbers, application numbers …). */
export const CounterModel = defineTenantModel<ICounter>(
  'Counter',
  {
    key: { type: String, required: true },
    seq: { type: Number, required: true, default: 0 },
  },
  (s) => {
    s.index({ schoolId: 1, key: 1 }, { unique: true });
  },
);

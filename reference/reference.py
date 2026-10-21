"""
Reference implementation of the allocation model (Python).
Purpose: ground truth for the TypeScript port. `python reference.py` regenerates
golden-cases.json and eta-table.json. If the TS port disagrees, re-read the spec
before changing either side.
"""
import csv, json, itertools, statistics, os
from datetime import datetime, timedelta, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
CSV = os.path.join(ROOT, 'db', 'seeds', 'delivery_records.csv')
FIX = os.path.join(ROOT, 'tests', 'fixtures')
WIB = timezone(timedelta(hours=7))

# ---- constants (all configurable in the real app) ----
W_SPEED, W_COST = 0.5, 0.5
ETA_SCALE_MIN, COST_SCALE = 200.0, 500.0
COST_PER_SHIPMENT, COST_PER_KM, COLD_MULT = 50.0, 5.0, 1.4
SHRINK_K = 2
PEAK = [(7*60, 9*60+30), (16*60, 19*60)]      # minutes since midnight, [start, end)

PRODUCTS = {
 'P001': ('Surgical Gloves (Box of 100)', False),
 'P002': ('Vaccine - Hepatitis B (10-dose vial)', True),
 'P003': ('Disposable Syringe (Box of 50)', False),
 'P004': ('Vaccine - Tetanus Toxoid (10-dose vial)', True),
 'P005': ('Paracetamol Tablets (Box of 100)', False),
}
# id: (city, km, cold_storage, refrigerated_vehicle)
WAREHOUSES = {
 'W01': ('Surabaya', 5, False, False), 'W02': ('Surabaya', 12, True, False),
 'W03': ('Sidoarjo', 25, False, False), 'W04': ('Gresik', 30, True, True),
 'W05': ('Malang', 90, False, False), 'W06': ('Malang', 95, True, False),
 'W07': ('Pasuruan', 45, True, True), 'W08': ('Jember', 150, True, True),
}
STOCK0 = {
 'W01': {'P001': 200, 'P003': 500, 'P005': 300},
 'W02': {'P001': 50, 'P002': 30, 'P004': 20},
 'W03': {'P001': 300, 'P003': 200},
 'W04': {'P002': 40, 'P004': 25, 'P005': 100},
 'W05': {'P001': 400, 'P003': 300, 'P005': 500},
 'W06': {'P002': 20, 'P004': 30, 'P003': 100},
 'W07': {'P002': 8, 'P004': 10, 'P001': 150},
 'W08': {'P002': 60, 'P004': 50, 'P005': 200},
}
def cold_capable(w): return WAREHOUSES[w][2] and WAREHOUSES[w][3]

# ---- ETA model ----
def bucket_of(dow, minutes):                      # dow: 'Mon'..'Sun' in WIB
    if dow in ('Sat', 'Sun'): return 'weekend'
    return 'peak' if any(a <= minutes < b for a, b in PEAK) else 'off_peak'

def load_records():
    recs = []
    with open(CSV, encoding='utf-8') as f:
        for r in csv.DictReader(f):
            h, m = map(int, r['start_time'].split(':'))
            recs.append((r['warehouse_id'], bucket_of(r['day'], h*60+m), int(r['duration_min'])))
    return recs

def eta_stats(recs):
    out = {}
    for w in WAREHOUSES:
        allv = [d for (ww, b, d) in recs if ww == w]
        wm = statistics.median(allv)
        out[w] = {'warehouseMedian': wm, 'count': len(allv), 'buckets': {}}
        for b in ('peak', 'off_peak', 'weekend'):
            v = [d for (ww, bb, d) in recs if ww == w and bb == b]
            n = len(v)
            bm = statistics.median(v) if n else None
            est = wm if n == 0 else (n*bm + SHRINK_K*wm)/(n + SHRINK_K)
            out[w]['buckets'][b] = {'n': n, 'bucketMedian': bm, 'estimate': est}
    return out

def to_wib(iso):
    dt = datetime.fromisoformat(iso.replace('Z', '+00:00')).astimezone(WIB)
    return dt, ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'][dt.weekday()]

# ---- planning ----
def ship_cost(w, items):
    c = COST_PER_SHIPMENT + COST_PER_KM*WAREHOUSES[w][1]
    if any(PRODUCTS[p][1] for p in items): c *= COLD_MULT
    return c

def available(stock, w, p):
    if PRODUCTS[p][1] and not cold_capable(w): return 0
    return stock[w].get(p, 0)

def allocate(stock, order, subset, etas):
    alloc = {}
    for p, q in sorted(order.items()):
        need = q
        for w in sorted(subset, key=lambda x: (etas[x], x)):
            t = min(need, available(stock, w, p))
            if t > 0: alloc.setdefault(w, {})[p] = t; need -= t
            if need == 0: break
        if need > 0: return None
    return alloc

def plans(stock, order, etas):
    out = []
    for k in range(1, len(WAREHOUSES)+1):
        for sub in itertools.combinations(sorted(WAREHOUSES), k):
            a = allocate(stock, order, sub, etas)
            if a is not None and len(a) == k:
                slow = max(etas[w] for w in a)
                cost = sum(ship_cost(w, items) for w, items in a.items())
                score = W_SPEED*slow/ETA_SCALE_MIN + W_COST*cost/COST_SCALE
                out.append({'warehouses': sorted(a), 'alloc': a, 'slowest': slow, 'cost': cost, 'score': score})
    out.sort(key=lambda p: (round(p['score'], 9), len(p['warehouses']), p['warehouses']))
    return out

def shortfalls(stock, order):
    sf = []
    for p, q in order.items():
        net = sum(stock[w].get(p, 0) for w in stock)
        ship = sum(available(stock, w, p) for w in stock)
        if ship < q: sf.append({'productId': p, 'requested': q, 'available': ship, 'totalInNetwork': net,
                                'cause': 'COLD_CHAIN' if (PRODUCTS[p][1] and net >= q) else 'STOCK'})
    return sf

def run(order, ordered_at, stock=None):
    stock = stock or {w: dict(v) for w, v in STOCK0.items()}
    stats = eta_stats(load_records())
    dt, dow = to_wib(ordered_at); b = bucket_of(dow, dt.hour*60 + dt.minute)
    etas = {w: stats[w]['buckets'][b]['estimate'] for w in WAREHOUSES}
    sf = shortfalls(stock, order)
    if sf:
        reason = 'INSUFFICIENT_STOCK' if any(s['cause'] == 'STOCK' for s in sf) else 'COLD_CHAIN_UNAVAILABLE'
        return {'ok': False, 'status': 422, 'reason': reason, 'shortfalls': sf}
    ps = plans(stock, order, etas); best, alts = ps[0], ps[1:3]
    return {'ok': True, 'bucket': b, 'best': best, 'alternatives': alts, 'etas': etas}

CASES = [
 ('G01 45 Hep B splits across cold-chain warehouses', {'P002': 45}, '2026-10-20T13:00:00+07:00'),
 ('G02 50 Hep B needs W08', {'P002': 50}, '2026-10-20T13:00:00+07:00'),
 ('G03 120 Hep B exceeds shippable stock (158 exist, 108 shippable)', {'P002': 120}, '2026-10-20T13:00:00+07:00'),
 ('G04 250 gloves single close warehouse', {'P001': 250}, '2026-10-21T10:00:00+07:00'),
 ('G05 10 Hep B + 100 gloves, Monday rush hour', {'P002': 10, 'P001': 100}, '2026-10-19T08:00:00+07:00'),
 ('G06 mixed order where one warehouse could cover all but splitting wins', {'P001': 113, 'P002': 5, 'P004': 7}, '2026-10-19T19:24:00+07:00'),
 ('G07 syringes + paracetamol, Friday peak', {'P003': 100, 'P005': 200}, '2026-10-23T17:30:00+07:00'),
 ('G08 same order on Saturday', {'P003': 100, 'P005': 200}, '2026-10-24T11:00:00+07:00'),
 ('G09 UTC input equals Monday 08:00 WIB (timezone test)', {'P002': 10, 'P001': 100}, '2026-10-19T01:00:00Z'),
 ('G10 100 Tetanus exceeds shippable stock (135 exist, 85 shippable)', {'P004': 100}, '2026-10-20T13:00:00+07:00'),
 ('G11 impossible gloves quantity', {'P001': 5000}, '2026-10-20T13:00:00+07:00'),
]

def main():
    stats = eta_stats(load_records())
    json.dump(stats, open(os.path.join(FIX, 'eta-table.json'), 'w'), indent=2)
    golden = []
    for name, order, at in CASES:
        r = run(order, at); g = {'name': name, 'order': order, 'orderedAt': at}
        if not r['ok']:
            g['expect'] = {'status': 422, 'reason': r['reason'],
                           'shortfalls': [{k: x[k] for k in ('productId', 'requested', 'available')} for x in r['shortfalls']]}
        else:
            fmt = lambda p: {'warehouses': p['warehouses'], 'allocation': p['alloc'],
                             'slowestMinutes': round(p['slowest'], 4), 'cost': round(p['cost'], 4), 'score': round(p['score'], 6)}
            g['expect'] = {'status': 200, 'timeBucket': r['bucket'], 'best': fmt(r['best']),
                           'alternatives': [fmt(p) for p in r['alternatives']]}
        golden.append(g)
    json.dump(golden, open(os.path.join(FIX, 'golden-cases.json'), 'w'), indent=2)
    for g in golden:
        e = g['expect']
        if e['status'] == 200:
            b = e['best']; print(f"{g['name'][:62]:62} {'+'.join(b['warehouses']):12} {b['slowestMinutes']:7.2f} min cost {b['cost']:6.0f} [{e['timeBucket']}]")
        else: print(f"{g['name'][:62]:62} 422 {e['reason']}")
if __name__ == '__main__': main()

import json
import pathlib
import re
import statistics
import sys
root=pathlib.Path(sys.argv[1])
report={"baseline_ref":(root/"baseline-ref.txt").read_text().strip() if (root/"baseline-ref.txt").exists() else "origin/qa","scope":"Synthetic fixtures; not production timings or total tab RAM"}
for label in ("baseline","candidate"):
    data={}
    for metric in ("streaming","search","browser"):
        path=root/f"{metric}-{label}.json"
        if path.exists(): data[metric]=json.loads(path.read_text())
    path=root/f"http-{label}.log"
    if path.exists(): data['http']=[json.loads(line) for line in path.read_text().splitlines() if line.startswith('{')]
    path=root/f"tail-{label}.log"
    if path.exists():
        rows=re.findall(r'BenchmarkLoadingTailSequence\S*\s+\d+\s+([\d.]+) ns/op\s+([\d.]+) B/op',path.read_text())
        data['tail']={"median_ns_per_read":statistics.median(float(row[0]) for row in rows),"median_bytes_per_read":statistics.median(float(row[1]) for row in rows)}
    report[label]=data
(root/'report.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps(report,indent=2))

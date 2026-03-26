#!/usr/bin/env python3
"""Fix light-mode visibility in SuguValManagement.tsx by replacing
hardcoded dark-only CSS classes with theme-aware dk ternaries."""
import re

FILE = 'client/src/pages/SuguValManagement.tsx'

with open(FILE, 'r', encoding='utf-8-sig') as f:
    content = f.read()

lines = content.split('\n')
N = len(lines)
print(f"Read {N} lines")

target_ranges = [
    (422, 724),   # DashboardTab
    (728, 780),   # CategoryFiles
    (784, 1122),  # AchatsTab
    (1126, 1604), # FraisTab
    (1643, 1647), # CategoryBadge
    (1650, 2037), # BanqueTab
    (2041, 2300), # CaisseTab
    (2304, 2838), # RHTab
    (2842, 3026), # AuditTab
    (3030, 3165), # FileUploadModal
    (3169, N),    # ArchivesTab
]

def in_target(ln):
    for s, e in target_ranges:
        if s <= ln <= e:
            return True
    return False

# (token, dark_class, light_class) - most specific first
PATS = [
    ('hover:bg-white/10', 'hover:bg-white/10', 'hover:bg-slate-100'),
    ('hover:bg-white/5', 'hover:bg-white/5', 'hover:bg-slate-50'),
    ('hover:text-white/80', 'hover:text-white/80', 'hover:text-slate-900'),
    ('hover:text-white', 'hover:text-white', 'hover:text-slate-900'),
    ('text-white/80', 'text-white/80', 'text-slate-800'),
    ('text-white/70', 'text-white/70', 'text-slate-700'),
    ('text-white/60', 'text-white/60', 'text-slate-600'),
    ('text-white/50', 'text-white/50', 'text-slate-500'),
    ('text-white/40', 'text-white/40', 'text-slate-400'),
    ('text-white/30', 'text-white/30', 'text-slate-300'),
    ('text-white/20', 'text-white/20', 'text-slate-200'),
    ('text-white', 'text-white', 'text-slate-800'),
    ('bg-white/20', 'bg-white/20', 'bg-slate-200'),
    ('bg-white/10', 'bg-white/10', 'bg-slate-100'),
    ('bg-white/5', 'bg-white/5', 'bg-white'),
    ('border-white/20', 'border-white/20', 'border-slate-300'),
    ('border-white/10', 'border-white/10', 'border-slate-200'),
    ('border-white/5', 'border-white/5', 'border-slate-100'),
    ('bg-black/30', 'bg-black/30', 'bg-white/80'),
    ('bg-slate-900', 'bg-slate-900', 'bg-white'),
]

def tern(d, l):
    return '${dk ? "' + d + '" : "' + l + '"}'

def repl_tok(t):
    for pat, d, l in PATS:
        if t == pat:
            return tern(d, l), True
    return t, False

def proc_cls(s):
    parts = s.split(' ')
    out = []
    ch = False
    for p in parts:
        if not p:
            out.append(p)
            continue
        np, did = repl_tok(p)
        out.append(np)
        if did:
            ch = True
    return ' '.join(out), ch

def proc_line(line):
    # inputClass/selectClass -> ic
    line = line.replace('className={inputClass}', 'className={ic}')
    line = line.replace('className={selectClass}', 'className={ic}')
    line = line.replace('className={inputClass +', 'className={ic +')
    line = line.replace('className={selectClass +', 'className={ic +')

    # className="..."
    def rp(m):
        cls = m.group(1)
        nc, ch = proc_cls(cls)
        if ch:
            return 'className={`' + nc + '`}'
        return m.group(0)

    line = re.sub(r'className="([^"]*)"', rp, line)

    # className={`...`}
    def rt(m):
        c = m.group(1)
        parts = c.split(' ')
        out = []
        ch = False
        for p in parts:
            if not p:
                out.append(p)
                continue
            if '${' in p:
                out.append(p)
                continue
            np, did = repl_tok(p)
            out.append(np)
            if did:
                ch = True
        if ch:
            return 'className={`' + ' '.join(out) + '`}'
        return m.group(0)

    line = re.sub(r'className=\{`([^`]*)`\}', rt, line)

    return line

# Process lines
res = []
changes = 0
for i, l in enumerate(lines):
    ln = i + 1
    if in_target(ln):
        nl = proc_line(l)
        if nl != l:
            changes += 1
        res.append(nl)
    else:
        res.append(l)

print(f"Changed {changes} lines via class replacement")

# Insert dk/ic declarations (bottom to top to avoid shifting)
inserts = [
    (3170, ['    const dk = useSuguDark();', '    const ic = useInputClass();']),  # ArchivesTab
    (3031, ['    const dk = useSuguDark();', '    const ic = useInputClass();']),  # FileUploadModal
    (2843, ['    const dk = useSuguDark();', '    const ic = useInputClass();']),  # AuditTab
    (2305, ['    const dk = useSuguDark();', '    const ic = useInputClass();']),  # RHTab
    (2042, ['    const dk = useSuguDark();', '    const ic = useInputClass();']),  # CaisseTab
    (1651, ['    const dk = useSuguDark();', '    const ic = useInputClass();']),  # BanqueTab
    (1644, ['    const dk = useSuguDark();']),                                      # CategoryBadge
    (1127, ['    const dk = useSuguDark();', '    const ic = useInputClass();']),  # FraisTab
    (785, ['    const dk = useSuguDark();', '    const ic = useInputClass();']),   # AchatsTab
    (729, ['    const dk = useSuguDark();']),                                      # CategoryFiles
    (423, ['    const dk = useSuguDark();']),                                      # DashboardTab
]

for ln, new_lines in inserts:
    idx = ln - 1
    for nl in reversed(new_lines):
        res.insert(idx, nl)

print(f"Inserted {sum(len(nl) for _, nl in inserts)} declaration lines")

with open(FILE, 'w', encoding='utf-8') as f:
    f.write('\n'.join(res))

print(f"Done! Total lines: {len(res)}")

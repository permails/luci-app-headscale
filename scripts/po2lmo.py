#!/usr/bin/env python3
import os
import re
import struct
import sys

def sfh_hash(data):
    if isinstance(data, str):
        data = data.encode('utf-8')
    length = len(data)
    if length == 0:
        return 0
    hash_val = length
    rem = length & 3
    pos = 0
    
    for _ in range(length >> 2):
        val1 = data[pos] | (data[pos+1] << 8)
        val2 = data[pos+2] | (data[pos+3] << 8)
        hash_val = (hash_val + val1) & 0xFFFFFFFF
        tmp = ((val2 << 11) ^ hash_val) & 0xFFFFFFFF
        hash_val = ((hash_val << 16) ^ tmp) & 0xFFFFFFFF
        hash_val = (hash_val + (hash_val >> 11)) & 0xFFFFFFFF
        pos += 4
        
    if rem == 3:
        val1 = data[pos] | (data[pos+1] << 8)
        val2 = data[pos+2]
        if val2 >= 128: val2 -= 256
        hash_val = (hash_val + val1) & 0xFFFFFFFF
        hash_val = (hash_val ^ (hash_val << 16)) & 0xFFFFFFFF
        hash_val = (hash_val ^ ((val2 << 18) & 0xFFFFFFFF)) & 0xFFFFFFFF
        hash_val = (hash_val + (hash_val >> 11)) & 0xFFFFFFFF
    elif rem == 2:
        val1 = data[pos] | (data[pos+1] << 8)
        hash_val = (hash_val + val1) & 0xFFFFFFFF
        hash_val = (hash_val ^ (hash_val << 11)) & 0xFFFFFFFF
        hash_val = (hash_val + (hash_val >> 17)) & 0xFFFFFFFF
    elif rem == 1:
        val1 = data[pos]
        if val1 >= 128: val1 -= 256
        hash_val = (hash_val + val1) & 0xFFFFFFFF
        hash_val = (hash_val ^ (hash_val << 10)) & 0xFFFFFFFF
        hash_val = (hash_val + (hash_val >> 1)) & 0xFFFFFFFF
        
    hash_val = (hash_val ^ (hash_val << 3)) & 0xFFFFFFFF
    hash_val = (hash_val + (hash_val >> 5)) & 0xFFFFFFFF
    hash_val = (hash_val ^ (hash_val << 4)) & 0xFFFFFFFF
    hash_val = (hash_val + (hash_val >> 17)) & 0xFFFFFFFF
    hash_val = (hash_val ^ (hash_val << 25)) & 0xFFFFFFFF
    hash_val = (hash_val + (hash_val >> 6)) & 0xFFFFFFFF
    return hash_val

def parse_po(file_path):
    with open(file_path, 'r', encoding='utf-8') as f:
        lines = f.readlines()
    
    entries = []
    curr_msgid = None
    curr_msgstr = None
    mode = None
    
    for line in lines:
        line = line.strip()
        if not line or line.startswith('#'):
            if curr_msgid is not None and curr_msgstr is not None:
                if curr_msgid: # skip header
                    entries.append((curr_msgid, curr_msgstr))
                curr_msgid = None
                curr_msgstr = None
                mode = None
            continue
            
        if line.startswith('msgid '):
            if curr_msgid is not None and curr_msgstr is not None and curr_msgid:
                entries.append((curr_msgid, curr_msgstr))
                curr_msgid = None
                curr_msgstr = None
            m = re.match(r'^msgid\s+"(.*)"$', line)
            if m:
                curr_msgid = m.group(1).replace(r'\"', '"').replace(r'\n', '\n').replace(r'\t', '\t')
                mode = 'msgid'
        elif line.startswith('msgstr '):
            m = re.match(r'^msgstr\s+"(.*)"$', line)
            if m:
                curr_msgstr = m.group(1).replace(r'\"', '"').replace(r'\n', '\n').replace(r'\t', '\t')
                mode = 'msgstr'
        elif line.startswith('"') and line.endswith('"'):
            s = line[1:-1].replace(r'\"', '"').replace(r'\n', '\n').replace(r'\t', '\t')
            if mode == 'msgid' and curr_msgid is not None:
                curr_msgid += s
            elif mode == 'msgstr' and curr_msgstr is not None:
                curr_msgstr += s
                
    if curr_msgid is not None and curr_msgstr is not None and curr_msgid:
        entries.append((curr_msgid, curr_msgstr))
        
    return entries

def compile_lmo(po_file, lmo_file):
    entries = parse_po(po_file)
    
    data_payload = bytearray()
    index_entries = []
    
    # 1. Header entry: plural formula
    header_bytes = b"nplurals=1; plural=0;"
    data_payload.extend(header_bytes)
    index_entries.append({
        'key_id': 0,
        'plural_id': 0,
        'offset': 0,
        'length': len(header_bytes)
    })
    offset = len(header_bytes)
    
    seen = set()
    for msgid, msgstr in entries:
        if not msgid or not msgstr:
            continue
        if msgid in seen:
            continue
        seen.add(msgid)
        
        key_id = sfh_hash(msgid)
        msgstr_bytes = msgstr.encode('utf-8')
        str_len = len(msgstr_bytes)
        
        data_payload.extend(msgstr_bytes)
        index_entries.append({
            'key_id': key_id,
            'plural_id': 1,
            'offset': offset,
            'length': str_len
        })
        offset += str_len
        
    # Sort index entries by key_id, then plural_id
    index_entries.sort(key=lambda x: (x['key_id'], x['plural_id']))
    
    idx_offset = offset
    
    with open(lmo_file, 'wb') as f:
        # Write payload
        f.write(data_payload)
        
        # Write index table
        for e in index_entries:
            f.write(struct.pack('>IIII', e['key_id'], e['plural_id'], e['offset'], e['length']))
            
        # Write final index offset
        f.write(struct.pack('>I', idx_offset))
        
    print(f"Successfully compiled {len(index_entries)} translations from '{po_file}' into '{lmo_file}' ({os.path.getsize(lmo_file)} bytes)")

if __name__ == '__main__':
    po_in = sys.argv[1] if len(sys.argv) > 1 else 'po/zh_Hans/headscale.po'
    lmo_out = sys.argv[2] if len(sys.argv) > 2 else 'headscale.zh-cn.lmo'
    compile_lmo(po_in, lmo_out)

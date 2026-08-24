local parser = require "luci.template.parser"

local po_file = arg[1] or "/headscale.po"
local lmo_file = arg[2] or "/usr/lib/lua/luci/i18n/headscale.zh-cn.lmo"

local f = io.open(po_file, "r")
if not f then
    error("Cannot open " .. po_file)
end

local entries = {}
local curr_msgid = nil
local curr_msgstr = nil
local mode = nil

for line in f:lines() do
    local trimmed = line:gsub("^%s+", ""):gsub("%s+$", "")
    if trimmed == "" or string.sub(trimmed, 1, 1) == "#" then
        if curr_msgid and curr_msgstr and curr_msgid ~= "" then
            table.insert(entries, { msgid = curr_msgid, msgstr = curr_msgstr })
        end
        curr_msgid = nil
        curr_msgstr = nil
        mode = nil
    elseif string.sub(trimmed, 1, 6) == "msgid " then
        if curr_msgid and curr_msgstr and curr_msgid ~= "" then
            table.insert(entries, { msgid = curr_msgid, msgstr = curr_msgstr })
            curr_msgid = nil
            curr_msgstr = nil
        end
        curr_msgid = string.match(trimmed, '^msgid%s+"(.*)"$') or ""
        mode = "msgid"
    elseif string.sub(trimmed, 1, 7) == "msgstr " then
        curr_msgstr = string.match(trimmed, '^msgstr%s+"(.*)"$') or ""
        mode = "msgstr"
    elseif string.sub(trimmed, 1, 1) == '"' and string.sub(trimmed, -1) == '"' then
        local s = string.match(trimmed, '^"(.*)"$') or ""
        if mode == "msgid" and curr_msgid then
            curr_msgid = curr_msgid .. s
        elseif mode == "msgstr" and curr_msgstr then
            curr_msgstr = curr_msgstr .. s
        end
    end
end

if curr_msgid and curr_msgstr and curr_msgid ~= "" then
    table.insert(entries, { msgid = curr_msgid, msgstr = curr_msgstr })
end
f:close()

local function unescape(str)
    return str:gsub('\\"', '"'):gsub('\\n', '\n'):gsub('\\t', '\t'):gsub('\\\\', '\\')
end

local data_payload = {}
local index_entries = {}

-- 1. Insert header entry (plural formula)
local header_val = "nplurals=1; plural=0;"
table.insert(data_payload, header_val)
table.insert(index_entries, {
    key_id = 0,
    plural_id = 0,
    offset = 0,
    length = #header_val
})
local offset = #header_val

for _, item in ipairs(entries) do
    local msgid = unescape(item.msgid)
    local msgstr = unescape(item.msgstr)
    if msgid ~= "" and msgstr ~= "" then
        local key_id = parser.hash(msgid)
        local len = #msgstr
        table.insert(data_payload, msgstr)
        table.insert(index_entries, {
            key_id = key_id,
            plural_id = 1,
            offset = offset,
            length = len
        })
        offset = offset + len
    end
end

table.sort(index_entries, function(a, b)
    if a.key_id == b.key_id then
        return a.plural_id < b.plural_id
    end
    return a.key_id < b.key_id
end)

local out = io.open(lmo_file, "wb")
if not out then error("Cannot open " .. lmo_file) end

for _, str in ipairs(data_payload) do
    out:write(str)
end

local idx_offset = offset

for _, e in ipairs(index_entries) do
    local b = string.char(
        math.floor(e.key_id / 16777216) % 256,
        math.floor(e.key_id / 65536) % 256,
        math.floor(e.key_id / 256) % 256,
        e.key_id % 256,
        math.floor(e.plural_id / 16777216) % 256,
        math.floor(e.plural_id / 65536) % 256,
        math.floor(e.plural_id / 256) % 256,
        e.plural_id % 256,
        math.floor(e.offset / 16777216) % 256,
        math.floor(e.offset / 65536) % 256,
        math.floor(e.offset / 256) % 256,
        e.offset % 256,
        math.floor(e.length / 16777216) % 256,
        math.floor(e.length / 65536) % 256,
        math.floor(e.length / 256) % 256,
        e.length % 256
    )
    out:write(b)
end

local end_idx = string.char(
    math.floor(idx_offset / 16777216) % 256,
    math.floor(idx_offset / 65536) % 256,
    math.floor(idx_offset / 256) % 256,
    idx_offset % 256
)
out:write(end_idx)
out:close()

print(string.format("Successfully compiled %d translation entries into %s", #index_entries, lmo_file))

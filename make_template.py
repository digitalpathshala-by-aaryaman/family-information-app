# Rebuilds template/Family-Information-Book-Template.xlsx.
# First export the field definitions:  node -e "const d=require('./data.js');require('fs').writeFileSync('schema.json',JSON.stringify(d.BLOCKS))"
import json
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment
from openpyxl.worksheet.datavalidation import DataValidation
from openpyxl.utils import get_column_letter

blocks = json.load(open('schema.json'))
wb = Workbook()
head_font = Font(bold=True, color='FFFFFF')
head_fill = PatternFill('solid', fgColor='1D6B58')
wrap = Alignment(wrap_text=True, vertical='top')

readme = wb.active
readme.title = 'Read me'
lines = [
    'Family Information Book: Excel template',
    '',
    'How to use',
    '1. Each sheet matches one section of the book. Sheet names must stay exactly as they are.',
    '2. Table sheets: one row per item (one row per bank account, one row per FD, one row per policy).',
    '3. "About me", "Medical information" and "What the family should do" sheets: type the value in column B next to each item.',
    '4. Dates: type them as 25/03/2027 or use Excel date format.',
    '5. Amounts: type numbers only, without the ₹ sign or commas.',
    '6. Dropdown cells only accept the listed choices.',
    '7. Do not type passwords, PINs or OTPs in any sheet.',
    '8. Save the file, then in the app choose "Import Excel". Imported rows are added to the rows already in the app.',
    '',
    'Tip: to add 50 LIC policies, copy one row, change the policy details and paste it again. Then import once.',
]
for i, t in enumerate(lines, 1):
    c = readme.cell(row=i, column=1, value=t)
    c.alignment = wrap
    if i == 1: c.font = Font(bold=True, size=14)
    if t == 'How to use': c.font = Font(bold=True)
readme.column_dimensions['A'].width = 110

# hidden lists sheet holds dropdown choices
lists = wb.create_sheet('Lists')
lists.sheet_state = 'hidden'
col = 1
list_refs = {}
for b in blocks:
    for f in b['fields']:
        if f['t'] == 'sel':
            lists.cell(row=1, column=col, value=f"{b['id']}.{f['k']}")
            for r, opt in enumerate(f['o'], 2):
                lists.cell(row=r, column=col, value=opt)
            L = get_column_letter(col)
            list_refs[(b['id'], f['k'])] = f"Lists!${L}$2:${L}${len(f['o']) + 1}"
            col += 1

for b in blocks:
    ws = wb.create_sheet(b['title'][:31])
    if b['kind'] == 'single':
        ws.append(['Item', 'Value'])
        for c in ws[1]: c.font = head_font; c.fill = head_fill
        for r, f in enumerate(b['fields'], 2):
            ws.cell(row=r, column=1, value=f['l']).alignment = wrap
            cell = ws.cell(row=r, column=2)
            cell.alignment = wrap
            if f['t'] == 'sel':
                dv = DataValidation(type='list', formula1='=' + list_refs[(b['id'], f['k'])], allow_blank=True)
                ws.add_data_validation(dv); dv.add(cell)
            if f['t'] == 'date': cell.number_format = 'DD/MM/YYYY'
        ws.column_dimensions['A'].width = 42
        ws.column_dimensions['B'].width = 60
    else:
        headers = [f['l'] for f in b['fields']]
        ws.append(headers)
        for c in ws[1]:
            c.font = head_font; c.fill = head_fill; c.alignment = Alignment(wrap_text=True, vertical='center')
        ws.row_dimensions[1].height = 32
        ws.freeze_panes = 'A2'
        for i, f in enumerate(b['fields'], 1):
            L = get_column_letter(i)
            ws.column_dimensions[L].width = 22
            last = 500
            if f['t'] == 'sel':
                dv = DataValidation(type='list', formula1='=' + list_refs[(b['id'], f['k'])], allow_blank=True)
                ws.add_data_validation(dv); dv.add(f'{L}2:{L}{last}')
            if f['t'] == 'date':
                for r in range(2, last + 1): ws.cell(row=r, column=i).number_format = 'DD/MM/YYYY'
            if f['t'] == 'num':
                for r in range(2, last + 1): ws.cell(row=r, column=i).number_format = '#,##0.00'

wb.save('template/Family-Information-Book-Template.xlsx')
print('template written with', len(wb.sheetnames), 'sheets')

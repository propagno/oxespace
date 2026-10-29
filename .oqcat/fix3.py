PATH = 'src/components/OxeQuery/ConnectionDialog.tsx'
BLOCK = "\nconst STRONG_AND_CODE = {\n  strong: <strong />,\n  code: <code />\n}\n"
R = [(BLOCK, "\n")]
def POST(s):
    anchor = "import { splitHostInput } from '../../../shared/oxequeryHost'\n"
    return s.replace(anchor, anchor + "\n/** Markup the translated sentences may use. */" + BLOCK.rstrip('\n') + "\n", 1)

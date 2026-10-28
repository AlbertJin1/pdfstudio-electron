#!/bin/bash
U=/mnt/user-data/uploads; cd /home/claude/res
pairs="ITEAF-0315-20260713-002:ITEAF-0315-20260713-002_viaAcrobat PFF108_LoyaltyCardPlusApplicationForm:PFF108_LoyaltyCardPlusApplicationForm_viaAcrobat Liquidation_-_BTA-3038463-031020262035:Liquidation_-_BTA-3038463-031020262035_viaACROBAT ITEAF70_The_Market_Place_TMP_CENTRIO_-_723_WISEMEAT_TABLET:ITEAF70_The_Market_Place_TMP_CENTRIO_-_723_WISEMEAT_TABLET_viaACROBAT"
for p in $pairs; do k=${p%%:*}; a=${p##*:}; echo "### $k"
 if [ "$1" != "noacro" ]; then echo "-- Acrobat"; python3 /home/claude/app/tools/score.py $U/$k.pdf $U/$a.docx; fi
 for m in ${MODES:-auto editable}; do echo "-- app $m"; node /home/claude/app/tools/convert.mjs $U/$k.pdf $k.$m.docx $m >/dev/null 2>&1; python3 /home/claude/app/tools/score.py $U/$k.pdf $k.$m.docx; done
done 2>&1 | grep -v Warning

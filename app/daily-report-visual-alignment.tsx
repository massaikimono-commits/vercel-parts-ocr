"use client";

export default function DailyReportVisualAlignment() {
  return (
    <style jsx global>{`
      /*
       * Daily report visual-alignment calibration.
       * The PDF raster remains the geometry source of truth; these rules only tune
       * field anchors to the user's handwritten operational placement.
       * No viewport scaling, page scaling, or printer-specific mm compensation here.
       */
      body[data-ux-route="/schedule/print"] .deliveryEntry .reportWorkCode{
        left:34.5%!important;
        top:39%!important;
        width:18%!important;
        height:22%!important;
        justify-content:center!important;
        align-items:center!important;
        font-size:.72em!important;
        line-height:1!important;
      }
      body[data-ux-route="/schedule/print"] .inboundEntry .reportWorkCode{
        left:42.5%!important;
        top:39%!important;
        width:13%!important;
        height:22%!important;
        justify-content:center!important;
        align-items:center!important;
        font-size:.72em!important;
        line-height:1!important;
      }

      /* Due date: day/broad live on the printed upper due line; hour/minute on the lower line. */
      body[data-ux-route="/schedule/print"] .inboundEntry .dueDayValue{
        left:80.2%!important;
        top:3%!important;
        width:8.2%!important;
        height:29%!important;
        justify-content:center!important;
        align-items:center!important;
      }
      body[data-ux-route="/schedule/print"] .inboundEntry .dueBroadValue{
        left:88.2%!important;
        top:3%!important;
        width:10.2%!important;
        height:29%!important;
        justify-content:flex-start!important;
        align-items:center!important;
        padding-left:.15em!important;
      }
      body[data-ux-route="/schedule/print"] .inboundEntry .dueHourValue{
        left:76.8%!important;
        top:51%!important;
        width:8.2%!important;
        height:28%!important;
        justify-content:flex-end!important;
        align-items:center!important;
        padding-right:.1em!important;
      }
      body[data-ux-route="/schedule/print"] .inboundEntry .dueMinuteValue{
        left:88.4%!important;
        top:51%!important;
        width:8.2%!important;
        height:28%!important;
        justify-content:flex-start!important;
        align-items:center!important;
        padding-left:.1em!important;
      }

      /* Keep every top-row field inside one visual row band. */
      body[data-ux-route="/schedule/print"] .reportCustomer,
      body[data-ux-route="/schedule/print"] .reportVehicleNo,
      body[data-ux-route="/schedule/print"] .reportTime,
      body[data-ux-route="/schedule/print"] .reportAssignee,
      body[data-ux-route="/schedule/print"] .reportWorkCode,
      body[data-ux-route="/schedule/print"] .reportProgress,
      body[data-ux-route="/schedule/print"] .dueDayValue,
      body[data-ux-route="/schedule/print"] .dueBroadValue,
      body[data-ux-route="/schedule/print"] .dueHourValue,
      body[data-ux-route="/schedule/print"] .dueMinuteValue{
        box-sizing:border-box!important;
        overflow:hidden!important;
        white-space:nowrap!important;
      }

      /* Lower sections: match handwritten column reading order instead of generic centering. */
      body[data-ux-route="/schedule/print"] .stayingRow{
        grid-template-columns:10% 30% 40% 10% 10%!important;
      }
      body[data-ux-route="/schedule/print"] .bodyShopRow{
        grid-template-columns:12.5% 37.5% 25% 12.5% 12.5%!important;
      }
      body[data-ux-route="/schedule/print"] .plannedRow{
        grid-template-columns:42% 32% 26%!important;
      }
      body[data-ux-route="/schedule/print"] .secondaryRow>span{
        min-width:0!important;
        height:100%!important;
        display:flex!important;
        align-items:center!important;
        overflow:hidden!important;
        white-space:nowrap!important;
        text-overflow:ellipsis!important;
        line-height:1!important;
        padding:0 1px!important;
      }
      body[data-ux-route="/schedule/print"] .secondaryRow .secCustomer{
        justify-content:flex-start!important;
        text-align:left!important;
        padding-left:2px!important;
      }
      body[data-ux-route="/schedule/print"] .secondaryRow .secAssignee,
      body[data-ux-route="/schedule/print"] .secondaryRow .secInbound,
      body[data-ux-route="/schedule/print"] .secondaryRow .secDue{
        justify-content:center!important;
        text-align:center!important;
      }
      body[data-ux-route="/schedule/print"] .secondaryRow .secVehicle{
        position:relative!important;
        display:block!important;
        text-align:center!important;
      }
      body[data-ux-route="/schedule/print"] .secondaryRow .secVehicle>b,
      body[data-ux-route="/schedule/print"] .secondaryRow .secVehicle>small{
        position:absolute!important;
        top:16%!important;
        height:68%!important;
        display:flex!important;
        align-items:center!important;
        justify-content:center!important;
        overflow:hidden!important;
        white-space:nowrap!important;
        text-overflow:ellipsis!important;
        line-height:1!important;
      }
      body[data-ux-route="/schedule/print"] .stayingRow .secVehicle>b{
        left:1%!important;
        width:57%!important;
      }
      body[data-ux-route="/schedule/print"] .stayingRow .secVehicle>small{
        left:61%!important;
        width:37%!important;
        font-size:.74em!important;
      }
      body[data-ux-route="/schedule/print"] .plannedRow .secVehicle>b{
        left:1%!important;
        width:57%!important;
      }
      body[data-ux-route="/schedule/print"] .plannedRow .secVehicle>small{
        left:61%!important;
        width:37%!important;
        font-size:.74em!important;
      }
      body[data-ux-route="/schedule/print"] .plannedRow .secDue{
        position:relative!important;
        display:block!important;
      }
      body[data-ux-route="/schedule/print"] .plannedRow .secDue>b,
      body[data-ux-route="/schedule/print"] .plannedRow .secDue>small{
        position:absolute!important;
        top:16%!important;
        height:68%!important;
        display:flex!important;
        align-items:center!important;
        overflow:hidden!important;
        white-space:nowrap!important;
        text-overflow:ellipsis!important;
        line-height:1!important;
      }
      body[data-ux-route="/schedule/print"] .plannedRow .secDue>b{
        left:2%!important;
        width:35%!important;
        justify-content:flex-end!important;
      }
      body[data-ux-route="/schedule/print"] .plannedRow .secDue>small{
        left:43%!important;
        width:55%!important;
        justify-content:flex-start!important;
        font-size:.82em!important;
      }

      @media print{
        body[data-ux-route="/schedule/print"] .deliveryEntry .reportWorkCode,
        body[data-ux-route="/schedule/print"] .inboundEntry .reportWorkCode,
        body[data-ux-route="/schedule/print"] .inboundEntry .dueDayValue,
        body[data-ux-route="/schedule/print"] .inboundEntry .dueBroadValue,
        body[data-ux-route="/schedule/print"] .inboundEntry .dueHourValue,
        body[data-ux-route="/schedule/print"] .inboundEntry .dueMinuteValue,
        body[data-ux-route="/schedule/print"] .secondaryRow,
        body[data-ux-route="/schedule/print"] .secondaryRow>*{
          transform:none!important;
          -webkit-transform:none!important;
        }
      }
    `}</style>
  );
}

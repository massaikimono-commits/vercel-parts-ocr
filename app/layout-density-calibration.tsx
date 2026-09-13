"use client";

export default function LayoutDensityCalibration() {
  return (
    <style jsx global>{`
      /* Final screen-density layer. Kept separate from print geometry. */
      @media screen and (min-width:761px) and (max-width:1100px){
        body[data-ux-route] main{padding-top:8px!important}
        body[data-ux-route] .top{margin-bottom:7px!important;min-height:38px!important;gap:7px!important}
        body[data-ux-route] .top button{min-height:36px!important;padding:7px 9px!important}
        body[data-ux-route] .card{padding:14px!important}
        body[data-ux-route] h1{font-size:21px!important;line-height:1.22!important;margin:3px 0 8px!important}
        body[data-ux-route] h2{font-size:16px!important;line-height:1.25!important;margin:9px 0 7px!important}
        body[data-ux-route] .notice{padding:7px 9px!important;margin-top:5px!important;margin-bottom:7px!important;font-size:12px!important;line-height:1.4!important}
        body[data-ux-route] .actions{gap:6px!important}
        body[data-ux-route="/schedule/week"] .weekHero{padding:10px 12px!important;margin-bottom:6px!important}
        body[data-ux-route="/schedule/week"] .weekHero h1{font-size:21px!important;margin:2px 0!important}
        body[data-ux-route="/schedule/week"] .weekHero p{font-size:12px!important}
        body[data-ux-route="/schedule/week"] .jumpBar{padding:7px 9px!important;margin-bottom:6px!important}
        body[data-ux-route="/schedule/new"] .page>.card:first-of-type{padding:11px 14px!important}
        body[data-ux-route="/schedule/edit"] .editPage .card{padding:13px!important}
        body[data-ux-route="/settings/login-history"] main{padding:8px!important}
        body[data-ux-route="/settings/login-history"] .card{padding:13px!important}
        body[data-ux-route="/settings/business-calendar"] .calendarHead{padding:11px!important}
        body[data-ux-route="/settings/business-calendar"] .titleRow h1{font-size:21px!important}
        body[data-ux-route="/settings/business-calendar"] .importCard{padding:10px!important}
      }

      @media screen and (min-width:1101px){
        body[data-ux-route] main{padding-top:9px!important}
        body[data-ux-route] .top{margin-bottom:8px!important;min-height:40px!important;gap:8px!important}
        body[data-ux-route] .top button{min-height:38px!important;padding:7px 10px!important}
        body[data-ux-route] .card{padding:15px!important}
        body[data-ux-route] h1{font-size:23px!important;line-height:1.22!important;margin:3px 0 9px!important}
        body[data-ux-route] h2{font-size:17px!important;line-height:1.25!important;margin:10px 0 8px!important}
        body[data-ux-route] .eyebrow{font-size:11px!important}
        body[data-ux-route] .notice{padding:8px 10px!important;margin-top:6px!important;margin-bottom:8px!important;font-size:12px!important;line-height:1.4!important}
        body[data-ux-route] .actions{gap:7px!important}

        body[data-ux-route="/schedule/week"] .weekPage{padding-top:9px!important}
        body[data-ux-route="/schedule/week"] .weekHero{padding:10px 13px!important;margin-bottom:6px!important;border-radius:15px!important}
        body[data-ux-route="/schedule/week"] .weekHero h1{font-size:22px!important;margin:2px 0!important}
        body[data-ux-route="/schedule/week"] .weekHero p{font-size:12px!important}
        body[data-ux-route="/schedule/week"] .weekNav{gap:5px!important}
        body[data-ux-route="/schedule/week"] .weekNav button{padding:7px 9px!important}
        body[data-ux-route="/schedule/week"] .jumpBar{padding:7px 10px!important;margin-bottom:6px!important}
        body[data-ux-route="/schedule/week"] .weekSummary{margin-bottom:6px!important}

        body[data-ux-route="/schedule/new"] .page{padding-top:9px!important}
        body[data-ux-route="/schedule/new"] .page>.card:first-of-type{padding:11px 15px!important}
        body[data-ux-route="/schedule/new"] .page>.card:first-of-type .notice{max-width:760px!important}
        body[data-ux-route="/schedule/new"] .capacity{margin-top:6px!important;gap:6px!important}
        body[data-ux-route="/schedule/new"] .capacity>div{padding:6px 9px!important}

        body[data-ux-route="/schedule/edit"] .editPage{padding-top:9px!important}
        body[data-ux-route="/schedule/edit"] .editPage .card{padding:14px!important}
        body[data-ux-route="/schedule/edit"] .editPage .current{margin:7px 0!important;padding:8px 9px!important}
        body[data-ux-route="/schedule/edit"] .targetPreview{margin-top:7px!important;padding:9px 10px!important}

        body[data-ux-route="/settings/login-history"] main{padding:8px!important}
        body[data-ux-route="/settings/login-history"] .card{padding:14px!important}
        body[data-ux-route="/settings/login-history"] .card>p{font-size:12px!important;line-height:1.45!important;margin:5px 0 8px!important}

        body[data-ux-route="/settings/business-calendar"] .calendarPage{padding-top:9px!important}
        body[data-ux-route="/settings/business-calendar"] .calendarHead{padding:11px 13px!important;margin-bottom:8px!important}
        body[data-ux-route="/settings/business-calendar"] .titleRow h1{font-size:22px!important}
        body[data-ux-route="/settings/business-calendar"] .summary{margin-top:7px!important}
        body[data-ux-route="/settings/business-calendar"] .importCard{padding:10px 12px!important;margin-top:10px!important}
        body[data-ux-route="/settings/business-calendar"] .importSteps{margin-top:6px!important}
      }

      /*
       * A3 daily-report print calibration.
       * The overlay uses the original form's 1755 x 2482 pixel coordinate system
       * (150 dpi A3 portrait). Print geometry is intentionally isolated from all
       * screen/mobile/tablet/desktop density rules above.
       */
      @page{size:A3 portrait;margin:0}
      @media print{
        html,body{
          width:297mm!important;
          height:420mm!important;
          margin:0!important;
          padding:0!important;
          overflow:hidden!important;
          background:transparent!important;
        }
        body{
          -webkit-print-color-adjust:exact!important;
          print-color-adjust:exact!important;
        }
        body[data-ux-route="/schedule/print"] main{
          position:static!important;
          width:297mm!important;
          height:420mm!important;
          min-width:297mm!important;
          max-width:297mm!important;
          min-height:420mm!important;
          max-height:420mm!important;
          margin:0!important;
          padding:0!important;
          overflow:hidden!important;
        }
        body[data-ux-route="/schedule/print"] .noPrint{display:none!important}
        body[data-ux-route="/schedule/print"] .background,
        body[data-ux-route="/schedule/print"] .placeholder{display:none!important}
        body[data-ux-route="/schedule/print"] .sheet{
          position:fixed!important;
          left:0!important;
          top:0!important;
          right:auto!important;
          bottom:auto!important;
          width:297mm!important;
          height:420mm!important;
          min-width:297mm!important;
          max-width:297mm!important;
          min-height:420mm!important;
          max-height:420mm!important;
          margin:0!important;
          padding:0!important;
          aspect-ratio:auto!important;
          overflow:hidden!important;
          box-shadow:none!important;
          background:transparent!important;
          transform:none!important;
          -webkit-transform:none!important;
          transform-origin:0 0!important;
          break-inside:avoid!important;
          page-break-inside:avoid!important;
          page-break-after:avoid!important;
        }
        body[data-ux-route="/schedule/print"] .row,
        body[data-ux-route="/schedule/print"] .dateToken,
        body[data-ux-route="/schedule/print"] .secondary,
        body[data-ux-route="/schedule/print"] .delivery,
        body[data-ux-route="/schedule/print"] .inbound,
        body[data-ux-route="/schedule/print"] .reportEntry{
          transform:none!important;
          -webkit-transform:none!important;
        }
      }
    `}</style>
  );
}

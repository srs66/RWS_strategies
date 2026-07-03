// 机枪机甲风筝 — 影子级响应 + 预判走位
var GH = Packages.cn.tesseract.union.util.GameHelper;
var UC = Packages.com.corrodinggames.rts.strategy.game.units.class_426;

var UNIT_NAME = "mechMinigun";
var MAX_RANGE = 210;
var TICK_GAP = 1;
var ENGAGE_MARGIN = 1;
var SHADOW_TOLERANCE = 0;
var LOOKAHEAD_BASE = 600;
var LOOKAHEAD_SPEED = 20;

var track = {};

function dist(ax, ay, bx, by) {
    var dx = ax - bx, dy = ay - by;
    return Math.sqrt(dx * dx + dy * dy);
}

function unitName(u) {
    try { return String(u.field_1988.method_1660()); } catch (e) { return "?"; }
}

function unitHash(u) {
    try { return u.hashCode(); } catch (e) { return 0; }
}

var n = 0;

function onTick(tick) {
    n++;
    if (n % TICK_GAP !== 0) return;

    try {
        var game = GH.game;
        var me = game.field_6373;
        if (!me) return;
        var myTeam = me.field_1464;

        var ul = UC.field_1908;
        if (!ul) return;
        var sz = ul.size();

        var mechs = [];
        var enemies = [];
        for (var i = 0; i < sz; i++) {
            var u = ul.get(i);
            if (!u || u.field_1925 || u.field_4222) continue;
            var p = u.field_1927;
            if (!p) continue;
            if (p.field_1464 === myTeam && unitName(u) === UNIT_NAME) {
                mechs.push(u);
            } else if (p.field_1464 !== myTeam) {
                enemies.push(u);
            }
        }

        if (mechs.length === 0 || enemies.length === 0) return;

        // 更新敌人速度
        for (var k = 0; k < enemies.length; k++) {
            var en = enemies[k];
            var h = unitHash(en);
            var t = track[h];
            if (!t) { t = {}; track[h] = t; }
            var ex = en.field_4227, ey = en.field_4228;
            if (t.pt > 0) {
                var dt = tick - t.pt;
                if (dt > 0) {
                    t.vx = (ex - t.px) / dt;
                    t.vy = (ey - t.py) / dt;
                }
            }
            if (t.vx === undefined) { t.vx = 0; t.vy = 0; }
            t.px = ex;
            t.py = ey;
            t.pt = tick;
        }

        // 更新我方机甲速度
        for (var j = 0; j < mechs.length; j++) {
            var m = mechs[j];
            var h = unitHash(m);
            var t = track[h];
            if (!t) { t = {}; track[h] = t; }
            var mx = m.field_4227, my = m.field_4228;
            if (t.pt > 0) {
                var dt = tick - t.pt;
                if (dt > 0) {
                    t.vx = (mx - t.px) / dt;
                    t.vy = (my - t.py) / dt;
                }
            }
            if (t.vx === undefined) { t.vx = 0; t.vy = 0; }
            t.px = mx;
            t.py = my;
            t.pt = tick;
        }

        // 逐机甲决策
        for (var j = 0; j < mechs.length; j++) {
            var m = mechs[j];
            var mh = unitHash(m);
            var mt = track[mh];
            var mx = m.field_4227, my = m.field_4228;

            var best = null, bestD = Infinity, bestH = -1;
            for (var k = 0; k < enemies.length; k++) {
                var en = enemies[k];
                var d = dist(mx, my, en.field_4227, en.field_4228);
                if (d < bestD) { bestD = d; best = en; bestH = unitHash(en); }
            }
            if (!best) continue;

            var bt = track[bestH];
            var bvx = bt ? (bt.vx || 0) : 0;
            var bvy = bt ? (bt.vy || 0) : 0;
            var mvx = mt ? (mt.vx || 0) : 0;
            var mvy = mt ? (mt.vy || 0) : 0;

            var urgency = Math.max(0, Math.min(1, (MAX_RANGE - bestD) / MAX_RANGE));

            var closingSpeed = 0;
            if (mt && mt.prevDist !== undefined && mt.prevEnemyHash === bestH) {
                closingSpeed = (mt.prevDist - bestD) / TICK_GAP;
            }
            var relVx = bvx - mvx;
            var relVy = bvy - mvy;
            var toMechX = mx - best.field_4227;
            var toMechY = my - best.field_4228;
            var toMechLen = Math.sqrt(toMechX * toMechX + toMechY * toMechY);
            if (toMechLen < 0.001) toMechLen = 1;
            var projClosing = -(relVx * toMechX + relVy * toMechY) / toMechLen;
            if (Math.abs(projClosing) > 0.01) {
                closingSpeed = projClosing;
            }

            mt.prevDist = bestD;
            mt.prevEnemyHash = bestH;

            var lookahead = LOOKAHEAD_BASE + urgency * Math.max(0, closingSpeed) * LOOKAHEAD_SPEED;

            var predX = best.field_4227 + bvx * lookahead;
            var predY = best.field_4228 + bvy * lookahead;

            var dx = mx - predX;
            var dy = my - predY;
            var dd = Math.sqrt(dx * dx + dy * dy);
            if (dd < 1) dd = 1;

            var r = (MAX_RANGE - ENGAGE_MARGIN) / dd;
            var tx = predX + dx * r;
            var ty = predY + dy * r;

            if (dist(mx, my, tx, ty) < SHADOW_TOLERANCE) continue;

            var act = game.field_6412.method_2058(m.field_1927);
            act.method_2139(m);
            act.method_2134(tx, ty);
        }
    } catch (e) {}
}

function init() {}

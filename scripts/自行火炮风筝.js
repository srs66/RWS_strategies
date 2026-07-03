// 自行火炮风筝 — 影子级响应 + 预判走位 + 弹道补偿（慢速重力弹道增强预判）
var GH = Packages.cn.tesseract.union.util.GameHelper;
var UC = Packages.com.corrodinggames.rts.strategy.game.units.class_426;

var UNIT_NAME = "c_artillery";
var MAX_RANGE = 290;
var TICK_GAP = 50;
var ENGAGE_MARGIN = 10;
var SHADOW_TOLERANCE = 0;
var LOOKAHEAD_BASE = 65;
var LOOKAHEAD_SPEED = 32;

// 停止-开火 节奏控制（shootDelay=240帧）
// 持续移动会导致 isFixedFiring 单位无法开火，需要在后退间隙停顿
var HOLD_DURATION = 800;   // 停顿等开火的帧数
var RETREAT_DURATION = 2800; // 后撤等冷却的帧数（≈shootDelay - 开火耗时）

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

// 判断是否为有效敌方单位（排除中立/Gaia单位，如树木、资源点等）
function isValidEnemy(u, myTeam) {
    try {
        var p = u.field_1927;
        if (!p) return false;
        var team = p.field_1464;
        // 排除己方队伍
        if (team === myTeam) return false;
        // 排除Gaia/中立队伍（树木、资源点、地图装饰等）
        // Gaia队伍ID通常为 -1
        if (team < 0) return false;
        return true;
    } catch (e) {
        return false;
    }
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

        var units = [];
        var enemies = [];
        for (var i = 0; i < sz; i++) {
            var u = ul.get(i);
            if (!u || u.field_1925 || u.field_4222) continue;
            var p = u.field_1927;
            if (!p) continue;
            if (p.field_1464 === myTeam && unitName(u) === UNIT_NAME) {
                units.push(u);
            } else if (isValidEnemy(u, myTeam)) {
                enemies.push(u);
            }
        }

        if (units.length === 0 || enemies.length === 0) return;

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

        // 更新我方单位速度
        for (var j = 0; j < units.length; j++) {
            var u = units[j];
            var h = unitHash(u);
            var t = track[h];
            if (!t) { t = {}; track[h] = t; }
            var ux = u.field_4227, uy = u.field_4228;
            if (t.pt > 0) {
                var dt = tick - t.pt;
                if (dt > 0) {
                    t.vx = (ux - t.px) / dt;
                    t.vy = (uy - t.py) / dt;
                }
            }
            if (t.vx === undefined) { t.vx = 0; t.vy = 0; }
            t.px = ux;
            t.py = uy;
            t.pt = tick;
        }

        // 逐单位决策
        for (var j = 0; j < units.length; j++) {
            var u = units[j];
            var uh = unitHash(u);
            var ut = track[uh];
            var ux = u.field_4227, uy = u.field_4228;

            var best = null, bestD = Infinity, bestH = -1;
            for (var k = 0; k < enemies.length; k++) {
                var en = enemies[k];
                var d = dist(ux, uy, en.field_4227, en.field_4228);
                if (d < bestD) { bestD = d; best = en; bestH = unitHash(en); }
            }
            if (!best) continue;

            var bt = track[bestH];
            var bvx = bt ? (bt.vx || 0) : 0;
            var bvy = bt ? (bt.vy || 0) : 0;
            var uvx = ut ? (ut.vx || 0) : 0;
            var uvy = ut ? (ut.vy || 0) : 0;

            var urgency = Math.max(0, Math.min(1, (MAX_RANGE - bestD) / MAX_RANGE));

            var closingSpeed = 0;
            if (ut && ut.prevDist !== undefined && ut.prevEnemyHash === bestH) {
                closingSpeed = (ut.prevDist - bestD) / TICK_GAP;
            }
            var relVx = bvx - uvx;
            var relVy = bvy - uvy;
            var toUnitX = ux - best.field_4227;
            var toUnitY = uy - best.field_4228;
            var toUnitLen = Math.sqrt(toUnitX * toUnitX + toUnitY * toUnitY);
            if (toUnitLen < 0.001) toUnitLen = 1;
            var projClosing = -(relVx * toUnitX + relVy * toUnitY) / toUnitLen;
            if (Math.abs(projClosing) > 0.01) {
                closingSpeed = projClosing;
            }

            ut.prevDist = bestD;
            ut.prevEnemyHash = bestH;

            // 自行火炮弹道更慢且有重力弧线（弹速3.5，重力0.18），需要比火炮机甲更大的预判提前量
            var lookahead = LOOKAHEAD_BASE + urgency * Math.max(0, closingSpeed) * LOOKAHEAD_SPEED;

            var predX = best.field_4227 + bvx * lookahead;
            var predY = best.field_4228 + bvy * lookahead;

            var dx = ux - predX;
            var dy = uy - predY;
            var dd = Math.sqrt(dx * dx + dy * dy);
            if (dd < 1) dd = 1;

            var r = (MAX_RANGE - ENGAGE_MARGIN) / dd;
            var idealTx = predX + dx * r;
            var idealTy = predY + dy * r;

            var tdx = idealTx - ux;
            var tdy = idealTy - uy;
            var tdist = Math.sqrt(tdx * tdx + tdy * tdy);

            if (tdist < SHADOW_TOLERANCE) continue;

            // 判断是否需要后撤（敌人已进入射程内）
            var isRetreat = dd < (MAX_RANGE - ENGAGE_MARGIN);

            if (isRetreat) {
                // ============================================================
                // 停止-开火 节奏：自行火炮 isFixedFiring=true，移动时不会开火
                // 节奏：停顿 HOLD → 开火 → 后撤 RETREAT（等冷却）→ 停顿 HOLD → ...
                // shootDelay=240帧，HOLD=80帧（瞄准+开火），RETREAT=180帧（冷却期后撤）
                // ============================================================
                if (!ut.phase) { ut.phase = "hold"; ut.phaseTick = tick; }

                if (ut.phase === "hold") {
                    if (tick - ut.phaseTick >= HOLD_DURATION) {
                        // 停顿结束，切换到后撤阶段
                        ut.phase = "retreat";
                        ut.phaseTick = tick;
                    } else {
                        // 还在停顿等开火，不发送移动指令
                        continue;
                    }
                }

                if (ut.phase === "retreat") {
                    if (tick - ut.phaseTick >= RETREAT_DURATION) {
                        // 后撤结束，切换到停顿阶段等下一炮
                        ut.phase = "hold";
                        ut.phaseTick = tick;
                        continue; // 本帧不移动，开始停顿
                    }
                }

                // 后撤阶段：短距离倒车，炮口向敌
                var MAX_BACKSTEP = 50;
                var tx = ux + (tdx / tdist) * MAX_BACKSTEP;
                var ty = uy + (tdy / tdist) * MAX_BACKSTEP;
            } else {
                // 敌人尚远，正常前压，不做节奏限制
                var tx = idealTx;
                var ty = idealTy;
            }

            var act = game.field_6412.method_2058(u.field_1927);
            act.method_2139(u);
            act.method_2134(tx, ty);
        }
    } catch (e) {}
}

function init() {}

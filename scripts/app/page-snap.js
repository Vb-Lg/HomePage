/*
分页滚动控制器（CSS scroll-snap 协调版）。

一页一顿的主体交给 CSS scroll-snap（styles/pages/home.css）：
原生吸附走浏览器合成器，没有 rAF 补间那种丢帧卡顿。本脚本只负责 CSS 做不到的事：

1. 折叠过渡期间（--fold 在 0 与 1 之间）临时关闭 snap，避免吸附力
   和 hero-fold.js 的滚动跳跃互相顶牛，动画结束后恢复；
2. 折叠未完成时接管滚轮，保证第一屏向下滚一定触发折叠并翻到第二页；
3. 键盘翻页（方向键 / PageUp / PageDown / Home / End）；
4. 触摸滑动翻页。
*/
(function (window, document) {
	"use strict";

	var namespace = (window.PersonalSakuraGuide = window.PersonalSakuraGuide || {});
	var root = document.documentElement;
	var body = document.body;

	var WHEEL_INTERVAL = 400; /* 两次滚轮翻页的最小间隔，防止一次滚动连翻多页 */
	var TOUCH_THRESHOLD = 40; /* 触摸判定为一次翻页的最小位移 */

	var motionQuery = window.matchMedia ? window.matchMedia("(prefers-reduced-motion: reduce)") : null;
	var active = false;
	var snapWasOff = false;
	var lastWheelTime = 0;
	var touchStartY = 0;
	var touchTracking = false;
	var targetIndex = -1; /* 翻页动画进行中的目标索引，避免动画途中位置漂移导致跳页 */

	function isReducedMotion() {
		return !!(motionQuery && motionQuery.matches);
	}

	function getFold() {
		return namespace.app && typeof namespace.app.getFold === "function" ? namespace.app.getFold() : 0;
	}

	function getScrollTop() {
		return window.pageYOffset || root.scrollTop || 0;
	}

	/* 折叠过渡中关闭 snap，稳定后恢复 */
	function syncSnap() {
		if (!active) {
			return;
		}

		var fold = getFold();
		var inTransition = fold > 0.001 && fold < 0.999;

		if (inTransition && !snapWasOff) {
			snapWasOff = true;
			root.classList.add("is-snap-off");
			watchFold();
		} else if (!inTransition && snapWasOff) {
			snapWasOff = false;
			root.classList.remove("is-snap-off");
		}
	}

	function pageNodes() {
		return document.querySelectorAll("[data-page]");
	}

	/* 翻到第 index 个分页（0 起）；-1 表示回到页面顶部 */
	function scrollToPage(index) {
		var nodes = pageNodes();

		if (index < 0 || !nodes.length) {
			window.scrollTo({ top: 0, behavior: isReducedMotion() ? "auto" : "smooth" });
			return;
		}

		if (index > nodes.length - 1) {
			index = nodes.length - 1;
		}

		nodes[index].scrollIntoView({ behavior: isReducedMotion() ? "auto" : "smooth", block: "start" });
	}

	function currentPageIndex() {
		var nodes = pageNodes();

		/* 翻页动画途中：以目标页为基准继续翻，而不是半路的位置 */
		if (targetIndex >= 0) {
			return targetIndex;
		}

		var best = -1;
		var bestDistance = Infinity;

		for (var i = 0; i < nodes.length; i++) {
			var distance = Math.abs(nodes[i].getBoundingClientRect().top);

			if (distance < bestDistance) {
				bestDistance = distance;
				best = i;
			}
		}

		return best;
	}

	function go(direction) {
		var index = currentPageIndex();

		if (index < 0) {
			return;
		}

		var next = index + direction;

		if (next < 0) {
			targetIndex = -1;
			scrollToPage(-1);
			return;
		}

		targetIndex = next;
		scrollToPage(next);

		/* scrollIntoView 结束后清掉锁定，下一次翻页以实际位置为准 */
		window.setTimeout(function () {
			targetIndex = -1;
		}, 700);
	}

	/* fold = 0（第一页顶部）时让位给 hero-fold 的折叠逻辑 */
	function shouldDeferToFold() {
		return getFold() < 0.5 || getScrollTop() <= 1;
	}

	function handleWheel(event) {
		if (!active || event.ctrlKey) {
			return;
		}

		var delta = Math.abs(event.deltaY) > Math.abs(event.deltaX) ? event.deltaY : event.deltaX;

		if (Math.abs(delta) < 4) {
			return;
		}

		var now = Date.now();

		if (now - lastWheelTime < WHEEL_INTERVAL) {
			event.preventDefault();
			return;
		}

		lastWheelTime = now;
		event.preventDefault();

		/* 折叠过渡中：不额外翻页（hero-fold 正在做折叠 + 跳第二页） */
		if (snapWasOff) {
			return;
		}

		/* 第一页顶部：向下滚直接翻到第一个分页（折叠由 hero-fold 完成） */
		go(delta > 0 ? 1 : -1);
	}

	function handleKeyDown(event) {
		if (!active) {
			return;
		}

		var handled = true;

		switch (event.key) {
			case "ArrowDown":
			case "PageDown":
				go(1);
				break;
			case "ArrowUp":
			case "PageUp":
				go(-1);
				break;
			case "Home":
				scrollToPage(-1);
				break;
			case "End":
				scrollToPage(pageNodes().length - 1);
				break;
			default:
				handled = false;
		}

		if (handled) {
			event.preventDefault();
		}
	}

	function handleTouchStart(event) {
		if (!active || event.touches.length !== 1) {
			return;
		}

		touchTracking = true;
		touchStartY = event.touches[0].clientY;
	}

	function handleTouchMove(event) {
		if (!active || !touchTracking || event.touches.length !== 1) {
			return;
		}

		var delta = touchStartY - event.touches[0].clientY;

		if (Math.abs(delta) >= TOUCH_THRESHOLD) {
			touchTracking = false;
			go(delta > 0 ? 1 : -1);
		}
	}

	function handleTouchEnd() {
		touchTracking = false;
	}

	function attach() {
		window.addEventListener("wheel", handleWheel, { passive: false });
		window.addEventListener("keydown", handleKeyDown);
		window.addEventListener("touchstart", handleTouchStart, { passive: true });
		window.addEventListener("touchmove", handleTouchMove, { passive: true });
		window.addEventListener("touchend", handleTouchEnd, { passive: true });
		window.addEventListener("resize", syncSnap, { passive: true });
		watchFold();
	}

	/*
	snap-off 只在折叠补间期间为真。补间是 rAF 驱动的，不触发 scroll 事件，
	所以补间激活期间挂一个轻量 rAF 轮询，等 fold 稳定后立即恢复 snap。
	*/
	function watchFold() {
		if (!snapWasOff) {
			return;
		}

		syncSnap();
		window.requestAnimationFrame(watchFold);
	}

	function activate() {
		if (active) {
			return;
		}

		active = true;
		syncSnap();
		attach();
	}

	/* hero-fold 的折叠动画结束（或未折叠）后才接管，避免两个滚动控制器打架 */
	function isFoldSettled() {
		var fold = getFold();

		return fold >= 0.999 || fold <= 0.001;
	}

	function tryActivate() {
		if (active) {
			return;
		}

		if (isFoldSettled()) {
			activate();
			return;
		}

		window.setTimeout(tryActivate, 200);
	}

	function watchIntro() {
		if (!body.classList.contains("is-intro")) {
			tryActivate();
			return;
		}

		if (!window.MutationObserver) {
			window.setTimeout(tryActivate, 3000);
			return;
		}

		var observer = new window.MutationObserver(function () {
			if (body.classList.contains("is-intro")) {
				return;
			}

			observer.disconnect();
			tryActivate();
		});

		observer.observe(body, { attributeFilter: ["class"], attributes: true });
		window.setTimeout(function () {
			if (active) {
				return;
			}

			observer.disconnect();
			tryActivate();
		}, 4000);
	}

	if (document.readyState === "loading") {
		document.addEventListener("DOMContentLoaded", watchIntro, false);
	} else {
		watchIntro();
	}
})(window, document);

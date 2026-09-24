/*
首屏滚动折叠控制器。
负责把折叠进度写进 --fold（0 = 展开的首屏，1 = 收起的透明页眉），
并实测折叠态的几何信息，交给 styles/pages/home.css 里的 calc() 就地插值。

折叠方式：向下滚过阈值后播放一次收起动画，往上滚回阈值以下再展开。
*/
(function (window, document) {
	"use strict";

	var namespace = (window.PersonalSakuraGuide = window.PersonalSakuraGuide || {});
	var root = document.documentElement;
	var body = document.body;
	var hero = document.querySelector(".hero");
	var avatarFrame = document.querySelector(".hero__avatar-frame");
	var contentSection = document.querySelector(".hero__content");
	var navSection = document.querySelector(".hero__nav");
	var titleNode = document.querySelector(".hero__title");

	if (!hero || !avatarFrame || !contentSection || !navSection || !titleNode) {
		return;
	}

	var MEASURE_CLASS = "is-measuring";
	var FOLDED_CLASS = "is-folded";
	var OFFSET_VARIABLES = [
		"--fold-x-avatar",
		"--fold-x-content",
		"--fold-y-content",
		"--fold-x-nav",
		"--fold-y-nav",
	];
	var MEASURE_DELAY = 160;
	var INTRO_TIMEOUT = 4000;
	var FOLD_DURATION = 600;
	var FOLD_HYSTERESIS = 0.12;
	var FOLD_TRIGGER = 0.5;

	var motionQuery = window.matchMedia ? window.matchMedia("(prefers-reduced-motion: reduce)") : null;
	var active = false;
	var currentFold = 0;
	var targetFold = 0;
	var headerHeight = 0;
	var scrollRange = 0;
	var scrollFrame = 0;
	var tweenFrame = 0;
	var tweenFrom = 0;
	var tweenTo = 0;
	var tweenStart = 0;
	var measureTimer = 0;

	function clamp(value, min, max) {
		if (value < min) {
			return min;
		}

		return value > max ? max : value;
	}

	function easeInOut(ratio) {
		if (ratio < 0.5) {
			return 2 * ratio * ratio;
		}

		return 1 - Math.pow(-2 * ratio + 2, 2) / 2;
	}

	function readVariable(name) {
		return window.getComputedStyle(root).getPropertyValue(name).trim();
	}

	function toPixels(value) {
		var number = parseFloat(value);

		if (!number && number !== 0) {
			return 0;
		}

		if (/rem$/.test(value)) {
			return number * parseFloat(window.getComputedStyle(root).fontSize);
		}

		return number;
	}

	function getScrollTop() {
		return window.pageYOffset || root.scrollTop || 0;
	}

	function getProgress() {
		if (scrollRange <= 0) {
			return 0;
		}

		return clamp(getScrollTop() / scrollRange, 0, 1);
	}

	function isReducedMotion() {
		return !!(motionQuery && motionQuery.matches);
	}

	function applyFold(value) {
		currentFold = value;
		root.style.setProperty("--fold", value.toFixed(4));
		body.classList.toggle(FOLDED_CLASS, value > 0.5);
	}

	/* 内容从页眉下方滑过时补一层背景遮罩，滑到哪儿渐隐到哪儿 */
	function applyScrim() {
		var span = Math.max(1, headerHeight * 0.75);
		var overlap = clamp((getScrollTop() - scrollRange) / span, 0, 1);

		root.style.setProperty("--fold-scrim", overlap.toFixed(4));
	}

	/*
	先临时把页面切到折叠态（--fold: 1、偏移归零、过渡关闭），
	量出折叠后各块需要平移多少，再恢复现场。
	整个过程在同一个任务里完成，用户看不到中间态。
	*/
	function measure() {
		var savedFold = root.style.getPropertyValue("--fold");

		body.classList.add(MEASURE_CLASS);
		root.style.setProperty("--fold", "1");
		OFFSET_VARIABLES.forEach(function (name) {
			root.style.setProperty(name, "0px");
		});

		// 折叠后只保留标题：--content-keep 就是标题的高度，用作 max-height 的下限
		root.style.setProperty("--content-keep", titleNode.getBoundingClientRect().height + "px");
		void hero.offsetHeight;

		var heroRect = hero.getBoundingClientRect();
		var avatarRect = avatarFrame.getBoundingClientRect();
		var titleRect = titleNode.getBoundingClientRect();
		var navRect = navSection.getBoundingClientRect();
		var gap = toPixels(readVariable("--fold-gap"));
		var inset = toPixels(readVariable("--fold-inset"));
		var navVisible = navRect.height > 1;

		var rowWidth = avatarRect.width + gap + titleRect.width + (navVisible ? gap + navRect.width : 0);
		var rowLeft = heroRect.left + heroRect.width / 2 - rowWidth / 2;
		var rowCenter = avatarRect.top + avatarRect.height / 2;

		root.style.setProperty("--fold-x-avatar", rowLeft - avatarRect.left + "px");
		root.style.setProperty("--fold-x-content", rowLeft + avatarRect.width + gap - titleRect.left + "px");
		root.style.setProperty(
			"--fold-y-content",
			rowCenter - (titleRect.top + titleRect.height / 2) + "px"
		);
		root.style.setProperty(
			"--fold-x-nav",
			navVisible
				? rowLeft + avatarRect.width + gap + titleRect.width + gap - navRect.left + "px"
				: "0px"
		);
		root.style.setProperty(
			"--fold-y-nav",
			navVisible ? rowCenter - (navRect.top + navRect.height / 2) + "px" : "0px"
		);

		// 页眉高度 = 折叠后首屏各块的堆叠高度 + 上下留白
		root.style.setProperty("--header-height", navRect.bottom - avatarRect.top + inset * 2 + "px");

		body.classList.remove(MEASURE_CLASS);

		if (savedFold) {
			root.style.setProperty("--fold", savedFold);
		} else {
			root.style.removeProperty("--fold");
		}

		updateScrollRange();
		primeFold();
		syncFold();
	}

	/*
	首次激活时直接落到当前滚动位置对应的状态，
	否则刷新在页面中部时会从展开态重放一次折叠动画。
	*/
	function primeFold() {
		if (tweenFrame) {
			return;
		}

		targetFold = getProgress() >= FOLD_TRIGGER ? 1 : 0;
		applyFold(targetFold);
	}

	/*
	折叠在这段滚动距离里走完：正好是「内容区顶部顶到页眉下沿」的距离。
	页面太短时退回按视口高度计算，避免永远折不起来。
	*/
	function updateScrollRange() {
		headerHeight = toPixels(readVariable("--header-height"));

		var maxScroll = Math.max(0, root.scrollHeight - window.innerHeight);
		var span = Math.min(window.innerHeight - headerHeight, maxScroll);

		scrollRange = span > 1 ? span : Math.max(1, window.innerHeight * 0.75);
	}

	/* 阈值判定带一点回滞，避免停在临界点附近时来回抖动 */
	function syncFold() {
		if (!active) {
			return;
		}

		var progress = getProgress();

		applyScrim();

		if (progress >= FOLD_TRIGGER) {
			setFoldTarget(1);
		} else if (progress <= FOLD_TRIGGER - FOLD_HYSTERESIS) {
			setFoldTarget(0);
		}
	}

	function setFoldTarget(value) {
		if (value === targetFold) {
			return;
		}

		targetFold = value;

		// 开启「减少动态效果」时不做补间，直接切换
		if (isReducedMotion()) {
			applyFold(value);
			return;
		}

		startTween();
	}

	function startTween() {
		if (tweenFrame) {
			return;
		}

		tweenFrom = currentFold;
		tweenTo = targetFold;
		tweenStart = 0;
		tweenFrame = window.requestAnimationFrame(step);

		function step(now) {
			if (!tweenStart) {
				tweenStart = now;
			}

			// 动画途中用户往回滚了：从当前位置重新出发
			if (tweenTo !== targetFold) {
				tweenFrom = currentFold;
				tweenTo = targetFold;
				tweenStart = now;
			}

			var ratio = clamp((now - tweenStart) / FOLD_DURATION, 0, 1);
			applyFold(tweenFrom + (tweenTo - tweenFrom) * easeInOut(ratio));

			if (ratio < 1) {
				tweenFrame = window.requestAnimationFrame(step);
				return;
			}

			tweenFrame = 0;

			if (tweenTo !== targetFold) {
				startTween();
			}
		}
	}

	function handleScroll() {
		if (!active || scrollFrame) {
			return;
		}

		scrollFrame = window.requestAnimationFrame(function () {
			scrollFrame = 0;
			syncFold();
		});
	}

	function scheduleMeasure() {
		if (!active) {
			return;
		}

		window.clearTimeout(measureTimer);
		measureTimer = window.setTimeout(measure, MEASURE_DELAY);
	}

	function activate() {
		if (active) {
			return;
		}

		active = true;
		measure();
	}

	/* 加载时的展开动画还在跑时不动 --fold，否则两套动画会互相打架 */
	function watchIntro() {
		if (!body.classList.contains("is-intro")) {
			activate();
			return;
		}

		if (!window.MutationObserver) {
			window.setTimeout(activate, INTRO_TIMEOUT);
			return;
		}

		var observer = new window.MutationObserver(function () {
			if (body.classList.contains("is-intro")) {
				return;
			}

			observer.disconnect();
			activate();
		});

		observer.observe(body, { attributeFilter: ["class"], attributes: true });
		window.setTimeout(function () {
			if (active) {
				return;
			}

			observer.disconnect();
			activate();
		}, INTRO_TIMEOUT);
	}

	window.addEventListener("scroll", handleScroll, { passive: true });
	window.addEventListener("resize", scheduleMeasure, { passive: true });
	window.addEventListener("orientationchange", scheduleMeasure, { passive: true });

	/*
	带着滚动位置打开的页面（刷新、回退）不需要加载动画：
	浏览器在这时已经恢复了滚动位置，直接跳过 is-intro 并接管折叠，
	否则首屏会先按展开态画一下再收起来。
	*/
	window.addEventListener(
		"load",
		function () {
			if (active || getScrollTop() <= 1) {
				return;
			}

			body.classList.remove("is-preload", "is-intro");
			activate();
		},
		{ once: true }
	);

	// 一言是异步替换的，文字换了要重新量一次
	document.addEventListener("app:taglinechange", scheduleMeasure, false);

	if (document.fonts && document.fonts.ready) {
		document.fonts.ready.then(function () {
			scheduleMeasure();
		});
	}

	if (motionQuery && typeof motionQuery.addEventListener === "function") {
		motionQuery.addEventListener("change", syncFold);
	}

	namespace.app = namespace.app || {};
	namespace.app.getFold = function () {
		return currentFold;
	};

	namespace.runtime = namespace.runtime || {};
	namespace.runtime.getFold = namespace.app.getFold;

	if (document.readyState === "loading") {
		document.addEventListener("DOMContentLoaded", watchIntro, false);
	} else {
		watchIntro();
	}
})(window, document);

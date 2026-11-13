# Growlog 버전 보관 및 인수인계 기록

- 작성 기준: v81
- 보관 범위: v28 ~ v80 중 현재 확보된 원본 ZIP
- 과거 화면 미리보기: v68 ~ v80

## 운영 원칙

1. 새 기능을 배포할 때 기존 버전을 덮어쓰지 않고 다음 버전 번호로 저장합니다.
2. 코드 롤백과 Supabase DB/Edge Function 롤백은 별개입니다. 과거 코드로 돌아갈 때 DB 테이블이나 함수를 함부로 삭제하지 않습니다.
3. 관리자 `버전 보관소`의 화면 미리보기는 읽기 전용이며 운영 데이터에 접근하지 않습니다.
4. 실제 복구가 필요할 때는 이 문서와 원본 ZIP 백업을 함께 확인합니다.

## 주요 버전 기록

- **v80** — 학부모 알림함·Web Push 준비  (`growlog_v80_notifications_push.zip`)
- **v79** — 학부모 사진저장 호환성 개선  (`growlog_v79_photo_save_compat.zip`)
- **v78** — 모바일 첫 화면 여백 제거  (`growlog_v78_mobile_hero_flush.zip`)
- **v77** — 모바일 첫 화면 사진 높이 복원  (`growlog_v77_mobile_hero_restore.zip`)
- **v76** — 홈화면 추가 개선·지도 바로가기  (`growlog_v76_pwa_map_jump.zip`)
- **v75** — 아이디·비밀번호 찾기  (`growlog_v75_account_recovery.zip`)
- **v74** — 사회성 연결 선택사항/없음  (`growlog_v74_social_growth_optional(1).zip`)
- **v73** — 스토리보드게임 관찰유형 4·7 보강  (`growlog_v73_storyboard_enneagram47.zip`)
- **v72** — 첫 화면 사진 하단 틈 제거  (`growlog_v72_hero_no_gap.zip`)
- **v71** — 첫 화면 풀스크린 사진  (`growlog_v71_fullscreen_hero.zip`)
- **v70** — 첫 화면 전체폭 랜딩  (`growlog_v70_fullwidth_landing.zip`)
- **v69** — 지도 검색·신청 링크  (`growlog_v69_map_search_apply_links.zip`)
- **v68** — 공개 수업지도  (`growlog_v68_public_class_map.zip`)
- **v67** — 강사 업로드 진행률  (`growlog_v67_upload_progress.zip`)
- **v66** — 로그인 통계 탭 수정  (`growlog_v66_login_tab_fix.zip`)
- **v65** — 관리자 사진·영상 갤러리  (`growlog_v65_admin_media_gallery.zip`)
- **v64** — 학부모 로그인 집계  (`growlog_v64_parent_login_stats.zip`)
- **v63** — 강사 일일특강 구분  (`growlog_v63_teacher_trial_section.zip`)
- **v62** — 설문 취소  (`growlog_v62_vote_cancel.zip`)
- **v61** — 설문 관리자/결과  (`growlog_v61_survey_admin.zip`)
- **v60** — 일일특강 실제 기록·성장지도  (`growlog_v60_trial_live_record_map.zip`)
- **v59** — 일일특강 재선택·취소  (`growlog_v59_reselect_cancel.zip`)
- **v58** — 일일특강 강사 수정  (`growlog_v58_trial_edit_teacher_fix.zip`)
- **v57** — 로고 수정  (`growlog_v57_logo_fix.zip`)
- **v56** — 일일특강 강사 미지정  (`growlog_v56_trial_optional_teacher.zip`)
- **v55** — 일일특강 검색  (`growlog_v55_trial_search.zip`)
- **v54** — 일일특강 탭 수정  (`growlog_v54_trial_tab_fix.zip`)
- **v53** — 정규수업 등록  (`growlog_v53_regular_registration.zip`)
- **v52** — 일일특강 최소 회원가입  (`growlog_v52_trial_minimal_register.zip`)
- **v51** — 일일특강 빠른 등록  (`growlog_v51_trial_quick_register.zip`)
- **v50** — 일일특강 센터 관리자 기능  (`growlog_v50_trial_center_admin.zip`)
- **v49** — 일일특강 탭 조건부 노출  (`growlog_v49_conditional_trial_tab.zip`)
- **v48** — 일일특강 QR 단일화  (`growlog_v48_single_trial_qr.zip`)
- **v47** — 일일특강 체험 구조  (`growlog_v47_trial_experience.zip`)
- **v46** — 월별 수업영상 반복 구조  (`growlog_v46_recurring_lesson_videos.zip`)
- **v41** — 초기 Growlog 개발 버전  (`growlog_v41.zip`)
- **v40** — 초기 Growlog 개발 버전  (`growlog_v40.zip`)
- **v39** — 초기 Growlog 개발 버전  (`growlog_v39.zip`)
- **v37** — 초기 Growlog 개발 버전  (`growlog_v37.zip`)
- **v36** — 초기 Growlog 개발 버전  (`growlog_v36.zip`)
- **v35** — 초기 Growlog 개발 버전  (`growlog_v35.zip`)
- **v34** — 초기 Growlog 개발 버전  (`growlog_v34.zip`)
- **v33** — 초기 Growlog 개발 버전  (`growlog_v33.zip`)
- **v32** — 초기 Growlog 개발 버전  (`growlog_v32.zip`)
- **v31** — 초기 Growlog 개발 버전  (`growlog_v31.zip`)
- **v30** — 초기 Growlog 개발 버전  (`growlog_v30.zip`)
- **v29** — 초기 Growlog 개발 버전  (`growlog_v29.zip`)
- **v28** — 초기 Growlog 개발 버전  (`growlog_v28.zip`)

## 파일 무결성(SHA-256)

- `growlog_v28.zip`  `d6444287eb95002dc26977ff3a283a15e22374138cd4716a9670a2e9fe9fa483`
- `growlog_v29.zip`  `5957f86ed728f6f61525c3af6cc96fc39fd3c80bebe399efab1cc74810d73dc4`
- `growlog_v30.zip`  `cc5c9d2a25d9801e1094fa7c9983cd577137ad7db3307374c12a276dde2ebfcc`
- `growlog_v31.zip`  `88c8456f637cddefc8b5ce5b19af75d9011c8261b5ae2acdb6969c3cd5cc0f74`
- `growlog_v32.zip`  `e35c76fb6dde18773ca3ae7c7410fe1f35e8aae6d904c22fec421e08d514732f`
- `growlog_v33.zip`  `5104e936072408c536a2634fcf499cf8f1d42dd7f0c3792232d84e9a164c7270`
- `growlog_v34.zip`  `f47754b1b59d07cd3df1ca061f89d819a5fa9b7e7bd11fdc7e17b4e83eb8d1ba`
- `growlog_v35.zip`  `bc038e2f3d0b0b55750a8f2006d98988593963c4d6beed1149db938e341b7bb2`
- `growlog_v36.zip`  `53f828191c6af969ab30af5917b316e1914cfc2e8d00a4951dc640a0d494a1b9`
- `growlog_v37.zip`  `75e0c7a4e9a3cbaf9f5df84ccb5b158b9addb8b7304352c4a8da76d1fc6ddddc`
- `growlog_v39.zip`  `63c6ff0783a455636f5c0ec49ada187d49daf4527bdf48db296fcfa104c324f9`
- `growlog_v40.zip`  `2e136607c1d16f60252328f90efc5d58d4d739c1153192e6c17f56240ceb12f2`
- `growlog_v41.zip`  `656e893f6d0f1116071f1cd5ff13a043a9cd0dc1a0e30269b877c8c7f51f9a9f`
- `growlog_v46_recurring_lesson_videos.zip`  `cf6a1560334fdf6dab39dcb6aacf105c4ed11eb6d1719c9e4fb85bde0d308d9e`
- `growlog_v47_trial_experience.zip`  `894556993f8c7c0ba5189741c948565f78d113d8ddd6f742669d422442cd03fc`
- `growlog_v48_single_trial_qr.zip`  `4d8821ddea8db7b056c7aef356dcae97c9124f27538eb83103a46fb1cd103611`
- `growlog_v49_conditional_trial_tab.zip`  `377ceb74c634098dfa01ffa98b82877d963e5e08fadfff94dc5fbf15d9e26742`
- `growlog_v50_trial_center_admin.zip`  `8273c82ece773b17059dfcf336eab59da64c88314a63f4e140196a56cb148809`
- `growlog_v51_trial_quick_register.zip`  `df1fdd2feb203732390b37097364e234fa7620b6090cf9f2c3486818c893a380`
- `growlog_v52_trial_minimal_register.zip`  `1bc6cc02bfd44c44edf7389356667e57f0c870d7f8fc67bd66803c9d7561ebcd`
- `growlog_v53_regular_registration.zip`  `efc4eb066cf8db5453376f4443ae442078a3bb3b3275b4ca9baf44de8015b5fa`
- `growlog_v54_trial_tab_fix.zip`  `6d5c90af9a352a2a825a654d02d51d1910ef4952e813d186d27a0083020d6a1e`
- `growlog_v55_trial_search.zip`  `956f6c733476d0b4ccf3f934e0a706bf9e25aa7301eb02c0714690b68b76aa9e`
- `growlog_v56_trial_optional_teacher.zip`  `ca30bf23264e2692f2504736d62b16b515160ffe7b8daa644d181b462324a62e`
- `growlog_v57_logo_fix.zip`  `366ddfa84c19dfc08facce1b0e3523895dfee3d68bfb47a2fc6339d99ae638d1`
- `growlog_v58_trial_edit_teacher_fix.zip`  `0d5f5594a6af92071bd484c11c735ba30fff897464e75597aa930d2e8455738e`
- `growlog_v59_reselect_cancel.zip`  `9f9901def6d6a58e49ff9c20a181eff92cad48913fbed1a2f128a7ef5e98c7a3`
- `growlog_v60_trial_live_record_map.zip`  `d9d02803eb4220057c356588ed75185c19cdb65f0c8a71e89c847a3df751f7b6`
- `growlog_v61_survey_admin.zip`  `860433710639a4a45cbf0368dd40592498d32f3a20b1468f66de954e611ca07e`
- `growlog_v62_vote_cancel.zip`  `718335c86ee44ceb72bd31b02489c89f073113906c4f863327fba137a5a1aa27`
- `growlog_v63_teacher_trial_section.zip`  `0299f9b345504505ea92d0bbcf448bad91a275e5ae017cafa781bf51db02a267`
- `growlog_v64_parent_login_stats.zip`  `b5e3acc7cd321016abd5b7b1177e2dffa7a19e139f0dce64a274475c7ead722d`
- `growlog_v65_admin_media_gallery.zip`  `c8e01d9b6c95dbabdbc57666268bdacaafc2cb418b76d8c0b21608740bff23dc`
- `growlog_v66_login_tab_fix.zip`  `dfd986866fa0bdddd4188e4aacaef36da5670901638c8590fd2caef2be028f7b`
- `growlog_v67_upload_progress.zip`  `0cb4cd94f98c99412b58c550e3e9733a746d8efa831283209719be01eca75c12`
- `growlog_v68_public_class_map.zip`  `be87ff184a9f7e8228fc480e5e838649ec5585ff443a76eef83bf148b74bb2ce`
- `growlog_v69_map_search_apply_links.zip`  `dacf9c9b038567c50f4a7392efd00856212f797fc86203a55438134b8dadc3dd`
- `growlog_v70_fullwidth_landing.zip`  `42c59eda3fb073f331494edea4bf46c01fd221633e0e9bd506d4f39b4a2cbb86`
- `growlog_v71_fullscreen_hero.zip`  `c7921e7abc10791395b993f738d6a5e2890b97b7c40487d02c7a484c58c9ac42`
- `growlog_v72_hero_no_gap.zip`  `a026cbaa9e174b00cff4e38efe183035153b19535814ad5bb928992e8d5009eb`
- `growlog_v73_storyboard_enneagram47.zip`  `e7144a9a6d14500445cdadca189639637c6339bbeca9bc6872bb17211b682c73`
- `growlog_v74_social_growth_optional(1).zip`  `8517174cafb07d6bb09a1f29395d5605ffdab11f2d7cfe0ba43607309f9b11f1`
- `growlog_v75_account_recovery.zip`  `8285ec5f2c83844f9b785678a51234c1caa0cba0455e22042a321f902dea50c2`
- `growlog_v76_pwa_map_jump.zip`  `50a867c7bf8e37fe0c9d4938757f7f0d775d4b0e5dd3f9d6dd54c3012b83bc57`
- `growlog_v77_mobile_hero_restore.zip`  `f6bca91abf662e86041002bcbe5fdda68ebd12588389015fd47aba0ab6388a5b`
- `growlog_v78_mobile_hero_flush.zip`  `f0dd9f5c4f8a154384dbe54ef86b5e550e16a9c9d7827de1be3218397aac7e4a`
- `growlog_v79_photo_save_compat.zip`  `503c0f872cf6a9857a6c069ee143b980886b5743cd95655e4b4d8cba5d58928c`
- `growlog_v80_notifications_push.zip`  `34d6bdf7472528c63ced8ead29a4b5502b04d3278e5de939a5daa87eb80a8ad1`

## 인수인계 체크리스트

- GitHub 저장소 접근 권한과 배포 방법 확인
- Supabase 프로젝트 접근 권한 확인
- 현재 운영 버전 번호 확인
- `config.js`의 공개 설정과 비밀키가 분리되어 있는지 확인
- Edge Functions 목록과 용도 확인
- 버전 ZIP 백업을 별도 Drive/외장 저장소에도 한 번 더 보관

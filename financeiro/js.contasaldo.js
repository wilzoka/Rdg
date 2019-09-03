$(function () {

    $('input[name="datahora"]').on('dp.change', function (e) {
        if (e.date) {
            console.log(e.date.format('DD/MM/YYYY HH:mm'));
            application.jsfunction('erp.financeiro.conta.js_saldoData', { idconta: application.functions.getUrlParameter('parent'), datahora: e.date.format('DD/MM/YYYY HH:mm') }, function (response) {
                if (response.success) {
                    $('input[name="valor"]').val(response.data);
                }
            });
        }
    });

});